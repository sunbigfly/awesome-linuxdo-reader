import { parseHTML } from 'linkedom';
import {
	ReaderCollectionProgressView,
	ReaderCollectionScrollWindow,
} from '../src/collection/reader-collection-floating-window.js';
import type { Cleanup } from '../src/kernel/lifecycle.js';
import {
	DiscourseNotificationRequestAdapter,
	type ReaderNotificationNativeAjaxPort,
	type ReaderNotificationNativeStatePort,
} from '../src/notification/discourse-notification-adapter.js';
import {
	ReaderNotificationController,
} from '../src/notification/reader-notification-controller.js';
import {
	ReaderNotificationPanelView,
} from '../src/notification/reader-notification-panel-view.js';
import {
	READER_NOTIFICATION_AGGREGATE_GROUP_ORDER,
	READER_NOTIFICATION_GROUP_ORDER,
	READER_NOTIFICATION_PANEL_GROUP_ORDER,
	READER_NOTIFICATION_GROUPS,
	normalizeNativeNotification,
	normalizeStoredReaderNotification,
	normalizeUserActionNotification,
	readerNotificationCategoryFilterKey,
	type ReaderNotificationGroupKey,
	type ReaderNotificationPresentedRecord,
} from '../src/notification/reader-notification-model.js';
import type {
	DiscourseNativeNotificationClick,
} from '../src/discourse/native-host-api.js';
import type {
	CollectionPageCacheLookup,
	CollectionPageRequest,
	NotificationPageCacheLookup,
	NotificationPageRequest,
	TopicTargetCacheLookup,
	TopicTargetRequest,
} from '../src/network/domain-request-gateway.js';
import type {
	RequestTransportResponse,
} from '../src/network/coordinated-request-client.js';
import type {
	ActionMutationDescriptor,
} from '../src/post/action-request-adapter.js';
import {
	PostActionController,
} from '../src/post/post-action-controller.js';
import {
	createReaderShellTemplate,
} from '../src/shell/reader-shell-template.js';
import {
	readerSelfObservationProjection,
} from '../src/user/reader-self-observation-projection.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function flushMicrotasks(): Promise<void> {
	for (let index = 0; index < 32; index += 1) await Promise.resolve();
}

class FakeNotificationNative implements ReaderNotificationNativeStatePort {
	readonly listeners = new Set<() => void>();
	readonly clickListeners = new Set<
		(click: DiscourseNativeNotificationClick) => void
	>();
	unread = 2;
	allReadCommits = 0;
	readCommits = 0;
	currentUsername = 'viewer';

	username(): string {
		return this.currentUsername;
	}

	unreadCount(): number {
		return this.unread;
	}

	markAllRead(): void {
		this.allReadCommits += 1;
		this.unread = 0;
	}

	markRead(): void {
		this.readCommits += 1;
		this.unread = Math.max(0, this.unread - 1);
	}

	async present(
		notifications: readonly unknown[],
	): Promise<readonly ReaderNotificationPresentedRecord[]> {
		return Object.freeze(notifications.map((value) => {
			const source = value as Readonly<Record<string, unknown>>;
			const data = source.data as
				| Readonly<Record<string, unknown>>
				| undefined;
			const actor = String(data?.display_username ?? 'alice');
			const postNumber = Number(source.post_number ?? 3);
			return Object.freeze({
				actor,
				typeName: 'replied',
				typeLabel: '回复',
				summary: `@${actor} · 回复了你 · 测试主题`,
				href: `/t/test/42/${postNumber}`,
				topicId: 42,
				postNumber,
			});
		}));
	}

	subscribeChanged(listener: () => void): Cleanup {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	subscribeClicked(
		listener: (click: DiscourseNativeNotificationClick) => void,
	): Cleanup {
		this.clickListeners.add(listener);
		return () => this.clickListeners.delete(listener);
	}

	emitChanged(): void {
		for (const listener of [...this.listeners]) listener();
	}

	emitClicked(click: DiscourseNativeNotificationClick): void {
		for (const listener of [...this.clickListeners]) listener(click);
	}
}

let consolidatedReplyCount = 2;

function payloadFor(path: string): unknown {
	if (path.startsWith('/latest.json?')) {
		const topicIds = new URL(path, 'https://example.invalid')
			.searchParams.getAll('topic_ids[]')
			.map(Number);
		return {
			topic_list: {
				topics: [{
					id: 42,
					category_id: 10,
					tags: ['alpha'],
				}].filter((topic) => topicIds.includes(topic.id)),
			},
		};
	}
	if (path.startsWith('/t/42.json?post_number=')) {
		return {
			post_stream: {
				posts: [{
					id: 299,
					post_number: 2,
					reply_to_post_number: 1,
					username: 'bob',
					avatar_template: '/u/bob/{size}.png',
					created_at: '2026-07-30T00:59:00.000Z',
				}, {
					id: 300,
					post_number: 3,
					reply_to_post_number: 1,
					username: 'alice',
					avatar_template: '/u/alice/{size}.png',
					created_at: '2026-07-30T01:00:00.000Z',
				}, ...(consolidatedReplyCount > 2 ? [{
					id: 301,
					post_number: 4,
					reply_to_post_number: 1,
					username: 'carol',
					avatar_template: '/u/carol/{size}.png',
					created_at: '2026-07-30T01:01:00.000Z',
				}] : []), ...(consolidatedReplyCount > 3 ? [{
					id: 302,
					post_number: 5,
					reply_to_post_number: 1,
					username: 'dave',
					avatar_template: '/u/dave/{size}.png',
					created_at: '2026-07-30T01:02:00.000Z',
				}] : [])],
			},
		};
	}
	if (path.startsWith('/notifications.json')) {
		return {
			notifications: [{
				id: 501,
				notification_type: 1,
				read: false,
				created_at: '2026-07-30T01:00:00.000Z',
				topic_id: 42,
				post_number: consolidatedReplyCount + 1,
				data: {
					display_username: 'alice',
					topic_title: '测试主题',
					consolidated_count: consolidatedReplyCount,
					reply_to_post_number: 1,
				},
			}],
			total_rows_notifications: 72,
			load_more_notifications: true,
		};
	}
	if (path.startsWith('/user_actions.json')) {
		const replyActions = path.includes('filter=6%2C9')
			? [{
				action_type: 6,
				post_id: 299,
				acting_user_id: 8,
				acting_username: 'bob',
				created_at: '2026-07-30T00:59:00.000Z',
				topic_id: 42,
				post_number: 2,
					title: '测试主题',
					excerpt: '<p>第一条逐条回复</p>',
					category_id: 10,
			}, ...(consolidatedReplyCount > 2 ? [{
				action_type: 6,
				post_id: 301,
				acting_user_id: 10,
				acting_username: 'carol',
				created_at: '2026-07-30T01:01:00.000Z',
				topic_id: 42,
				post_number: 4,
				title: '测试主题',
				excerpt: '<p>第三条逐条回复</p>',
			}] : []), ...(consolidatedReplyCount > 3 ? [{
				action_type: 6,
				post_id: 302,
				acting_user_id: 11,
				acting_username: 'dave',
				created_at: '2026-07-30T01:02:00.000Z',
				topic_id: 42,
				post_number: 5,
				title: '测试主题',
				excerpt: '<p>第四条逐条回复</p>',
			}] : [])] : [];
		return {
			user_actions: [...replyActions, {
				action_type: 6,
				post_id: 300,
				acting_user_id: 9,
				acting_username: 'alice',
				created_at: '2026-07-30T01:00:00.000Z',
				topic_id: 42,
				post_number: 3,
					title: '测试主题',
					excerpt: '<p>回复正文</p>',
					category_id: 20,
			}],
		};
	}
	if (path.includes('/boosts-received.json')) {
		return {
			boosts: [{
				id: 61,
				created_at: '2026-07-30T00:30:00.000Z',
				user: { username: 'booster', avatar_template: '/u/booster/{size}.png' },
				post: {
					topic_id: 43,
					post_number: 2,
					topic_title: 'Boost 主题',
					category_id: 40,
					tags: ['boost'],
				},
			}],
		};
	}
	if (path.startsWith('/discourse-reactions/')) {
		return {
			reactions: [{
				id: 71,
				reaction_user_id: 72,
				created_at: '2026-07-30T00:20:00.000Z',
				user: { username: 'reactor', avatar_template: '/u/reactor/{size}.png' },
				reaction: { reaction_value: 'heart' },
					post: {
						topic_id: 44,
						post_number: 5,
						topic_title: '回应主题',
						category_id: 30,
						tags: ['reaction'],
					},
			}],
		};
	}
	return {
		users: [
			{ id: 1, username: 'viewer' },
			{ id: 2, username: 'sender', avatar_template: '/u/sender/{size}.png' },
		],
		topic_list: {
			total_rows: 1,
			topics: [{
				id: 45,
				title: '私信主题',
				participants: [{ user_id: 1 }, { user_id: 2 }],
				highest_post_number: 4,
				last_read_post_number: 2,
				unread: 1,
					last_posted_at: '2026-07-30T00:10:00.000Z',
					category_id: 50,
					tags: ['private'],
			}],
		},
	};
}

class FakeAjax implements ReaderNotificationNativeAjaxPort {
	readonly nativeBinding = 'discourse/lib/ajax#ajax' as const;
	readonly paths: string[] = [];

	async request<T>(
		input: Parameters<ReaderNotificationNativeAjaxPort['request']>[0],
	): Promise<RequestTransportResponse<T>> {
		this.paths.push(input.path);
		return {
			ok: true,
			status: 200,
			value: payloadFor(input.path) as T,
		};
	}
}

class FakeGateway {
	readonly collectionRequests: CollectionPageRequest<unknown>[] = [];
	readonly requests: NotificationPageRequest<unknown>[] = [];
	readonly topicRequests: TopicTargetRequest<unknown>[] = [];
	readonly notificationCache = new Map<string, unknown>();
	readonly collectionCache = new Map<string, unknown>();
	readonly topicCache = new Map<string, unknown>();
	notificationBarrier: Promise<void> | null = null;
	reactionBarrier: Promise<void> | null = null;

	async cachedNotificationPage<T>(
		input: NotificationPageCacheLookup,
	): Promise<T | null> {
		const key = `${input.group}:${input.page}`;
		return this.notificationCache.has(key)
			? this.notificationCache.get(key) as T
			: null;
	}

	async cachedCollectionPage<T>(
		input: CollectionPageCacheLookup,
	): Promise<T | null> {
		const key = [
			input.collection,
			input.page,
			input.cursor ?? '',
			input.variant ?? '',
		].join(':');
		return this.collectionCache.has(key)
			? this.collectionCache.get(key) as T
			: null;
	}

	async cachedTopicTarget<T>(input: TopicTargetCacheLookup): Promise<T | null> {
		const key = [
			input.topicId,
			input.operation,
			input.postId ?? '',
			input.postNumber ?? '',
			input.cursor ?? '',
		].join(':');
		return this.topicCache.has(key) ? this.topicCache.get(key) as T : null;
	}

	async loadNotificationPage<T>(
		input: NotificationPageRequest<T>,
	): Promise<T> {
		this.requests.push(input as NotificationPageRequest<unknown>);
		const barrier = this.notificationBarrier;
		if (barrier) await barrier;
		const reactionBarrier = input.group === 'reactions'
			? this.reactionBarrier
			: null;
		if (reactionBarrier) await reactionBarrier;
		const response = await input.transport({
			signal: input.signal,
			attempt: 1,
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		this.notificationCache.set(`${input.group}:${input.page}`, response.value);
		return response.value;
	}

	async loadCollectionPage<T>(
		input: CollectionPageRequest<T>,
	): Promise<T> {
		this.collectionRequests.push(input as CollectionPageRequest<unknown>);
		const response = await input.transport({
			signal: input.signal,
			attempt: 1,
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		this.collectionCache.set([
			input.collection,
			input.page,
			input.cursor ?? '',
			input.variant ?? '',
		].join(':'), response.value);
		return response.value;
	}

	async loadTopicTarget<T>(
		input: TopicTargetRequest<T>,
	): Promise<T> {
		this.topicRequests.push(input as TopicTargetRequest<unknown>);
		const response = await input.transport({
			signal: input.signal,
			attempt: 1,
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		this.topicCache.set([
			input.topicId,
			input.operation,
			input.postId ?? '',
			input.postNumber ?? '',
			input.cursor ?? '',
		].join(':'), response.value);
		return response.value;
	}
}

const native = new FakeNotificationNative();
const ajax = new FakeAjax();
const gateway = new FakeGateway();
const abort = new AbortController();
const requests = new DiscourseNotificationRequestAdapter({
	gateway,
	ajax,
	native,
	authScope: 'account:test',
	signal: abort.signal,
	replyExpansionCache: {
		kind: 'discourse-topic-posts',
		tags: ['notifications'],
		freshForMs: 60_000,
		retainForMs: 86_400_000,
		persist: true,
	},
	categoryNameFor: (categoryId) => ({
		10: '开发',
		20: '反馈',
		30: '回应区',
		40: 'Boost 区',
		50: '私信区',
	})[categoryId] ?? '',
});

for (const groupKey of READER_NOTIFICATION_GROUP_ORDER) {
	const page = await requests.load(groupKey, 0);
	assert(
		page.group === groupKey &&
		gateway.requests.at(-1)?.group === (groupKey === 'other' ? 'all' : groupKey) &&
		page.records.length === (
			groupKey === 'all' || groupKey === 'replies'
				? 2
				: groupKey === 'other' ? 0 : 1
		),
		`分类 ${groupKey} 必须通过统一 adapter 返回归一化记录`,
	);
	if (groupKey === 'all') {
		assert(
			page.records.every((record) =>
				record.sourceNotificationId === 501) &&
			new Set(page.records.map((record) => record.identity)).size === 2 &&
			gateway.topicRequests.at(-1)?.operation ===
				'target:around:topic-id-query',
			'合并回复必须通过原生 Topic around 目录完整拆分，并保留真实通知 ID',
		);
	}
	if (groupKey === 'reactions') {
		assert(
			page.records[0]?.icon === 'emoji:heart' &&
			!page.records[0]?.summary.includes('heart'),
			'回应记录必须保留可渲染 emoji 身份，标题不得泄漏原始字段',
		);
	}
	if (groupKey === 'replies') {
		assert(
			page.records.some((record) =>
				record.categoryName === '开发' && !record.tags.length) &&
			page.records.some((record) =>
				record.categoryName === '反馈' && !record.tags.length),
			'真实 user_actions 响应只有类别，不得伪造并不存在的标签字段',
		);
	}
}
const rawReplyPage = await requests.load('replies', 0);
const refreshedReplyPage = await requests.load('replies', 0, { refresh: true });
assert(
	refreshedReplyPage.records.length === rawReplyPage.records.length &&
		gateway.requests.at(-1)?.parallelHead === true,
	'通知头页刷新必须标记为中央批次请求，普通分页不得擅自放大并发',
);
const [enrichedReplyPage] = await requests.enrichTopicTaxonomy([rawReplyPage]);
assert(
	enrichedReplyPage?.records.every((record) => record.tags.includes('alpha')) &&
	gateway.collectionRequests.length === 1 &&
	gateway.collectionRequests[0]?.collection === 'notification-topic-taxonomy' &&
	new URL(String(gateway.collectionRequests[0]?.input), 'https://example.invalid')
		.searchParams.getAll('topic_ids[]').join(',') === '42',
	'通知标签必须按去重 Topic ID 批量补全，不能为每条通知分别请求主题',
);
const notificationRequestsBeforeCachedReplay = gateway.requests.length;
const collectionRequestsBeforeCachedReplay = gateway.collectionRequests.length;
const ajaxRequestsBeforeCachedReplay = ajax.paths.length;
const cachedReplyPage = await requests.loadCached('replies', 0);
const [cachedEnrichedReplyPage] = cachedReplyPage
	? await requests.enrichCachedTopicTaxonomy([cachedReplyPage])
	: [];
assert(
	cachedEnrichedReplyPage?.records.every((record) =>
		record.tags.includes('alpha')) &&
	gateway.requests.length === notificationRequestsBeforeCachedReplay &&
	gateway.collectionRequests.length === collectionRequestsBeforeCachedReplay &&
	ajax.paths.length === ajaxRequestsBeforeCachedReplay,
	'通知与标签的持久缓存回放不得进入 scheduler、transport 或新增网络请求',
);
assert(
	ajax.paths.some((path) => path.startsWith(
		'/notifications.json?offset=0&limit=24&username=viewer',
	)) &&
	gateway.requests.find((request) => request.group === 'replies')?.variant ===
		'user-actions-limit-100-v1' &&
	ajax.paths.some((path) => path.includes(
		'/user_actions.json?offset=0&limit=100&username=viewer&filter=6%2C9',
	)) &&
	ajax.paths.some((path) => path.includes(
		'/discourse-boosts/users/viewer/boosts-received.json',
	)) &&
	ajax.paths.some((path) => path.includes(
		'/discourse-reactions/posts/reactions-received.json?username=viewer',
	)) &&
	ajax.paths.some((path) => path.includes(
		'/topics/private-messages-warnings/viewer.json?page=0',
	)),
		'15 分类必须覆盖原生通知、其他类型、用户动作、Boost、回应和六种私信端点',
);
assert(
	Object.values(READER_NOTIFICATION_GROUPS)
		.filter((group) => group.mode === 'notifications').length === 10 &&
	Object.values(READER_NOTIFICATION_GROUPS)
		.filter((group) => group.mode === 'messages').length === 6,
	'通知模型必须保留 9 个底层分类、1 个回应与赞合并投影和 6 个私信分类',
);
assert(
	READER_NOTIFICATION_PANEL_GROUP_ORDER.filter((key) =>
		READER_NOTIFICATION_GROUPS[key].mode === 'notifications').join(',') ===
		'all,replies,boosts,reactionLikes,mentions,edits,links,other',
	'通知子 tab 必须按全部、回复、Boost、回应与赞、@提及、编辑、链接、其他排列',
);

class OtherTypeNotificationNative extends FakeNotificationNative {
	override async present(
		notifications: readonly unknown[],
	): Promise<readonly ReaderNotificationPresentedRecord[]> {
		const types = new Map<number, readonly [string, string]>([
			[1, ['replied', '回复']],
			[6, ['private_message', '私信']],
			[14, ['custom', '已解决']],
			[25, ['reaction', '回应']],
			[34, ['assigned', '已指派']],
		]);
		return Object.freeze(notifications.map((value) => {
			const source = value as Readonly<Record<string, unknown>>;
			const type = types.get(Number(source.notification_type)) ??
				['unknown', '未知通知'];
			const data = source.data as Readonly<Record<string, unknown>>;
			return Object.freeze({
				actor: data.display_username,
				typeName: type[0],
				typeLabel: type[1],
				summary: `${type[1]} · ${String(data.topic_title ?? '')}`,
				href: `/t/test/${source.topic_id}/${source.post_number}`,
				topicId: source.topic_id,
				postNumber: source.post_number,
			});
		}));
	}
}

const otherTypePayload = Object.freeze({
	notifications: Object.freeze([
		[901, 1, 'alice'],
		[902, 25, 'reactor'],
		[903, 6, 'sender'],
		[904, 14, 'solver'],
		[905, 34, 'assigner'],
	].map(([id, notificationType, actor], index) => Object.freeze({
		id,
		notification_type: notificationType,
		read: false,
		created_at: `2026-08-17T00:0${index}:00.000Z`,
		topic_id: 90 + index,
		post_number: 2,
		data: Object.freeze({
			display_username: actor,
			topic_title: `通知 ${id}`,
		}),
	}))),
	total_rows_notifications: 5,
	load_more_notifications: false,
});
const otherTypeGateway = new FakeGateway();
const otherTypeRequests = new DiscourseNotificationRequestAdapter({
	gateway: otherTypeGateway,
	ajax: {
		nativeBinding: 'discourse/lib/ajax#ajax',
		async request<T>(): Promise<RequestTransportResponse<T>> {
			return {
				ok: true,
				status: 200,
				value: otherTypePayload as T,
			};
		},
	},
	native: new OtherTypeNotificationNative(),
	authScope: 'account:other-types',
	signal: abort.signal,
	replyExpansionCache: {
		kind: 'discourse-topic-posts',
		tags: ['notifications'],
		freshForMs: 60_000,
		retainForMs: 86_400_000,
		persist: true,
	},
});
const otherTypePage = await otherTypeRequests.load('other', 0, {
	expandConsolidated: false,
});
const cachedOtherTypePage = await otherTypeRequests.loadCached('other', 0, {
	expandConsolidated: false,
});
assert(
	otherTypeGateway.requests.length === 1 &&
		otherTypeGateway.requests[0]?.group === 'all' &&
		otherTypePage.group === 'other' &&
		otherTypePage.sourceTotal === 5 &&
		otherTypePage.records.map((record) => record.sourceNotificationId)
			.join(',') === '905,904' &&
		otherTypePage.records.every((record) => record.group === 'other') &&
		cachedOtherTypePage?.records.map((record) => record.typeLabel)
			.join(',') === '已指派,已解决',
	'“其他”必须复用原生所有页，只保留具体分类和私信未覆盖的类型，并可从同一原始缓存回放',
);

const sparseOtherCallbacks = new Map<number, () => void>();
const sparseOtherLoads: string[] = [];
const sparseOtherWrites: Array<Readonly<{
	complete: boolean;
	checkpointMode: string;
	sourceNextPage: number;
	sourceTotalHint: number;
	recordVersion: number;
}>> = [];
let sparseOtherScheduleId = 0;
const sparseOtherRecords = otherTypePage.records;
const sparseOtherController = new ReaderNotificationController({
	requests: {
		async load(group: ReaderNotificationGroupKey, page: number) {
			sparseOtherLoads.push(`${group}:${page}`);
			if (group === 'other') {
				return Object.freeze({
					group,
					page,
					records: Object.freeze([
						sparseOtherRecords[Math.min(page, 1)]!,
					]),
					total: page + 1,
					sourceTotal: 48,
					hasNext: page === 0,
					nextCursor: null,
				});
			}
			return Object.freeze({
				group,
				page,
				records: Object.freeze([]),
				total: 0,
				hasNext: false,
				nextCursor: null,
			});
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	projection: {
		async read(group) {
			return group === 'other'
				? Object.freeze({
					records: Object.freeze([sparseOtherRecords[0]!]),
					totalHint: 1,
					complete: true,
					updatedAt: 1,
					sourceNextPage: 1,
					sourcePageSize: 24,
					sourceOffset: 24,
				})
				: Object.freeze({
					records: Object.freeze([]),
					totalHint: 0,
					complete: true,
					updatedAt: 1,
				});
		},
		async write(group, _records, options) {
			if (group !== 'other') return;
			sparseOtherWrites.push(Object.freeze({
				complete: options?.complete === true,
				checkpointMode: String(options?.checkpointMode ?? ''),
				sourceNextPage: Number(options?.sourceNextPage ?? 0),
				sourceTotalHint: Number(options?.sourceTotalHint ?? 0),
				recordVersion: Number(options?.recordVersion ?? 0),
			}));
		},
	},
	native: new OtherTypeNotificationNative(),
	actions: {} as PostActionController,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	backgroundWarmDelayMs: 0,
	historyStepDelayMs: 0,
	schedule(callback) {
		const id = ++sparseOtherScheduleId;
		sparseOtherCallbacks.set(id, callback);
		return id;
	},
	cancel(handle) {
		sparseOtherCallbacks.delete(Number(handle));
	},
});
sparseOtherController.startBackgroundCache();
await flushMicrotasks();
await sparseOtherController.selectGroup('other');
await sparseOtherController.open();
await flushMicrotasks();
for (let step = 0; step < 4; step += 1) {
	if (sparseOtherController.snapshot.history.status === 'complete') break;
	const scheduled = sparseOtherCallbacks.entries().next().value as
		| [number, () => void]
		| undefined;
	if (!scheduled) break;
	sparseOtherCallbacks.delete(scheduled[0]);
	scheduled[1]();
	await flushMicrotasks();
}
assert(
	sparseOtherLoads.filter((entry) => entry === 'other:0').length >= 1 &&
	sparseOtherLoads.at(-1) === 'other:1' &&
	sparseOtherLoads.every((entry) => entry === 'other:0' || entry === 'other:1') &&
		sparseOtherController.snapshot.groupCounts.get('other') === 2 &&
		sparseOtherController.snapshot.history.status === 'complete' &&
		sparseOtherWrites.some((entry) =>
			entry.checkpointMode === 'replace' &&
			entry.complete === false &&
			entry.sourceNextPage === 1 &&
			entry.sourceTotalHint === 48) &&
		sparseOtherWrites.some((entry) =>
			entry.complete &&
			entry.sourceNextPage === 2 &&
			entry.sourceTotalHint === 48 &&
			entry.recordVersion === 2),
	'“其他”首屏发现原始总量超过错误完成断点时，必须替换断点并自动续传全部原生页：' +
		JSON.stringify({
			loads: sparseOtherLoads,
			writes: sparseOtherWrites,
			count: sparseOtherController.snapshot.groupCounts.get('other'),
			history: sparseOtherController.snapshot.history,
			callbacks: sparseOtherCallbacks.size,
		}),
);
sparseOtherController.destroy();

await requests.load('inbox', 0, {
	background: true,
	expandConsolidated: false,
});
assert(
	gateway.requests.at(-1)?.group === 'inbox' &&
	gateway.requests.at(-1)?.profile === 'surface-prefetch' &&
	gateway.requests.at(-1)?.cache?.freshForMs === 30 * 60_000 &&
	gateway.requests.at(-1)?.cache?.tags.includes('notifications'),
	'后台通知与私信预热必须走低优先级 surface-prefetch，并继续复用前台持久缓存身份',
);
await requests.load('replies', 1, { history: true });
assert(
	gateway.requests.at(-1)?.group === 'replies' &&
		gateway.requests.at(-1)?.page === 1 &&
		gateway.requests.at(-1)?.profile === 'background-prefetch' &&
		gateway.requests.at(-1)?.cache?.tags.includes('notification-history') &&
		!gateway.requests.at(-1)?.cache?.tags.includes('notifications') &&
		gateway.requests.at(-1)?.cache?.freshForMs ===
			180 * 24 * 60 * 60 * 1_000,
	'深层通知历史必须走最低 background 优先级，并使用不受头部事件失效的长期持久缓存',
);
await requests.load('replies', 1, {
	history: true,
	visibleHistory: true,
});
assert(
	gateway.requests.at(-1)?.group === 'replies' &&
		gateway.requests.at(-1)?.profile === 'surface-prefetch',
	'浮窗可见期的通知活动历史必须提升为可丢弃 surface-prefetch，仍经过中央请求链',
);
const cachedReactionCursor = 9_019;
gateway.notificationCache.set('reactions:0', Object.freeze({
	reactions: Object.freeze(Array.from({ length: 20 }, (_, index) =>
		Object.freeze({
			id: 8_000 + index,
			reaction_user_id: 9_000 + index,
			created_at: '2026-07-30T00:20:00.000Z',
			user: Object.freeze({ username: `reactor-${index}` }),
			reaction: Object.freeze({ reaction_value: 'heart' }),
			post: Object.freeze({
				topic_id: 44,
				post_number: 5,
				topic_title: '回应游标缓存',
			}),
		}),
	)),
}));
const reactionRequestsBeforeCursorResume = gateway.requests.length;
const reactionTransportsBeforeCursorResume = ajax.paths.length;
await requests.load('reactions', 1, { history: true });
assert(
	gateway.requests.length === reactionRequestsBeforeCursorResume + 1 &&
	gateway.requests.at(-1)?.group === 'reactions' &&
	gateway.requests.at(-1)?.page === 1 &&
	ajax.paths.length === reactionTransportsBeforeCursorResume + 1 &&
	ajax.paths.at(-1)?.includes(
		`before_reaction_user_id=${cachedReactionCursor}`,
	) === true,
	'回应深页必须直接复用上一页持久游标，只请求目标页；不得递归重发已失效的慢头页',
);
const persistentReplayRecord = normalizeUserActionNotification({
	action_type: 6,
	post_id: 350,
	acting_user_id: 19,
	acting_username: 'cached-user',
	created_at: '2026-07-30T01:30:00.000Z',
	topic_id: 142,
	post_number: 3,
	title: '持久缓存主题',
}, 'replies');
let persistentCacheReads = 0;
let persistentNetworkLoads = 0;
const persistentReplayController = new ReaderNotificationController({
	requests: {
		async loadCached(group: ReaderNotificationGroupKey, page: number) {
			persistentCacheReads += 1;
			return {
				group,
				page,
				records: group === 'replies'
					? Object.freeze([persistentReplayRecord])
					: Object.freeze([]),
				total: group === 'replies' ? 1 : 0,
				hasNext: false,
				nextCursor: null,
			};
		},
		async enrichCachedTopicTaxonomy(pages: readonly unknown[]) {
			return pages;
		},
		async load() {
			persistentNetworkLoads += 1;
			throw new Error('持久缓存命中后不应联网');
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	native,
	actions: {} as PostActionController,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
});
await persistentReplayController.open();
assert(
	persistentCacheReads === READER_NOTIFICATION_AGGREGATE_GROUP_ORDER.length + 1 &&
	persistentNetworkLoads === 0 &&
	persistentReplayController.snapshot.loading === false &&
	persistentReplayController.snapshot.records[0]?.identity ===
		persistentReplayRecord.identity,
	'页面刷新后的“全部”必须直接回放八类持久缓存，首屏不得强制刷新或等待 transport',
);
persistentReplayController.destroy();

const warmCallbacks = new Map<number, () => void>();
const warmLoads: string[] = [];
const warmNativeRecords = Object.freeze([
	normalizeNativeNotification({
		id: 801,
		notification_type: 1,
		read: false,
		created_at: '2026-07-30T01:00:00.000Z',
		topic_id: 42,
		post_number: 3,
		data: { display_username: 'alice', topic_title: '回复主题' },
	}, {
		actor: 'alice',
		typeName: 'replied',
		typeLabel: '回复',
		topicId: 42,
		postNumber: 3,
	}, 'all'),
	normalizeNativeNotification({
		id: 802,
		read: true,
		created_at: '2026-07-30T00:30:00.000Z',
		topic_id: 43,
		post_number: 2,
		data: { display_username: 'booster', topic_title: 'Boost 主题' },
	}, {
		actor: 'booster',
		typeName: 'boost',
		typeLabel: 'Boosts',
		topicId: 43,
		postNumber: 2,
	}, 'all'),
]);
const warmReplyRecord = normalizeUserActionNotification({
	action_type: 6,
	post_id: 300,
	acting_user_id: 9,
	acting_username: 'alice',
	created_at: '2026-07-30T01:00:00.000Z',
	topic_id: 42,
	post_number: 3,
	title: '回复主题',
}, 'replies');
let warmScheduleId = 0;
const warmController = new ReaderNotificationController({
	requests: {
		async load(
			group: ReaderNotificationGroupKey,
			page: number,
			options?: Parameters<DiscourseNotificationRequestAdapter['load']>[2],
			) {
				warmLoads.push([
					group,
					page,
					String(options?.background),
					String(options?.history),
					String(options?.expandConsolidated),
				].join(':'));
				return {
					group,
					page,
					records: group === 'all'
						? warmNativeRecords
						: group === 'replies'
							? Object.freeze([warmReplyRecord])
							: Object.freeze([]),
				total: group === 'all' ? 2 : group === 'replies' ? 1 : 0,
				hasNext: false,
				nextCursor: null,
			};
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	native,
	actions: {} as PostActionController,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	backgroundWarmDelayMs: 0,
	schedule(callback) {
		const id = ++warmScheduleId;
		warmCallbacks.set(id, callback);
		return id;
	},
	cancel(handle) {
		warmCallbacks.delete(Number(handle));
	},
});
assert(
	warmCallbacks.size === 0 &&
	warmLoads.length === 0 &&
	!warmController.snapshot.open,
	'后台消息缓存尚未启动时不得抢跑通知头页或深历史预热',
);
warmController.startBackgroundCache();
await flushMicrotasks();
for (let step = 0; step < 20; step += 1) {
	const scheduled = warmCallbacks.entries().next().value as
		| [number, () => void]
		| undefined;
	if (!scheduled) break;
	warmCallbacks.delete(scheduled[0]);
	scheduled[1]();
	await flushMicrotasks();
}
const warmLoadsBeforeOpen = warmLoads.length;
await warmController.open();
assert(
	warmLoads.slice(0, warmLoadsBeforeOpen).join(',') ===
		'replies:0:undefined:true:undefined,' +
		'likes:0:undefined:true:undefined,' +
		'mentions:0:undefined:true:undefined,' +
		'edits:0:undefined:true:undefined,' +
		'links:0:undefined:true:undefined,' +
		'boosts:0:undefined:true:undefined,' +
		'reactions:0:undefined:true:undefined,' +
		'other:0:undefined:true:undefined' &&
	warmLoads.slice(warmLoadsBeforeOpen).join(',') ===
		'replies:0:undefined:undefined:undefined,' +
		'likes:0:undefined:undefined:undefined,' +
		'mentions:0:undefined:undefined:undefined,' +
		'edits:0:undefined:undefined:undefined,' +
		'links:0:undefined:undefined:undefined,' +
		'boosts:0:undefined:undefined:undefined,' +
		'reactions:0:true:undefined:undefined,' +
		'other:0:undefined:undefined:undefined,' +
		'all:0:true:undefined:false' &&
	warmController.snapshot.open &&
	warmController.snapshot.records.length === 1 &&
	warmController.snapshot.records[0]?.identity === warmReplyRecord.identity &&
	warmController.snapshot.records[0]?.source === 'user-actions' &&
	warmController.snapshot.records[0]?.aggregateCount === null &&
	warmController.snapshot.error === null,
	'application 后台必须先恢复通知缓存；打开“全部”要立即增量回查八条头流与原生通知身份：' +
		JSON.stringify({
			loads: warmLoads,
			beforeOpen: warmLoadsBeforeOpen,
			afterOpen: warmLoads.length,
			records: warmController.snapshot.records.map((record) => record.identity),
			error: warmController.snapshot.error,
		}),
);
warmController.close();
assert(warmCallbacks.size === 0, '后台补齐完成后关闭消息面板不得重新排入任务');
warmController.destroy();

let hiddenNotificationActivityVisible = false;
const hiddenNotificationActivityListeners = new Set<() => void>();
const hiddenNotificationSchedules = new Map<number, () => void>();
let hiddenNotificationScheduleId = 0;
const hiddenNotificationLoads: string[] = [];
const hiddenNotificationController = new ReaderNotificationController({
	requests: {
		async load(group: ReaderNotificationGroupKey, page: number) {
			hiddenNotificationLoads.push(`${group}:${page}`);
			return Object.freeze({
				group,
				page,
				records: Object.freeze([]),
				total: 0,
				hasNext: false,
				nextCursor: null,
			});
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	native,
	actions: {} as PostActionController,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	backgroundWarmDelayMs: 0,
	activity: {
		visible: () => hiddenNotificationActivityVisible,
		subscribe(listener) {
			hiddenNotificationActivityListeners.add(listener);
			return () => hiddenNotificationActivityListeners.delete(listener);
		},
	},
	schedule(callback) {
		const id = ++hiddenNotificationScheduleId;
		hiddenNotificationSchedules.set(id, callback);
		return id;
	},
	cancel(handle) {
		hiddenNotificationSchedules.delete(Number(handle));
	},
});
hiddenNotificationController.startBackgroundCache();
await flushMicrotasks();
assert(
	hiddenNotificationSchedules.size === 0 && hiddenNotificationLoads.length === 0,
	'隐藏标签不得恢复或启动通知后台续传',
);
hiddenNotificationActivityVisible = true;
for (const listener of [...hiddenNotificationActivityListeners]) listener();
await flushMicrotasks();
assert(
	Number(hiddenNotificationSchedules.size) === 1,
	'标签恢复可见后必须从共享通知断点排入唯一后台任务',
);
hiddenNotificationActivityVisible = false;
for (const listener of [...hiddenNotificationActivityListeners]) listener();
assert(
	hiddenNotificationSchedules.size === 0 &&
	hiddenNotificationController.snapshot.history.status === 'paused',
	'通知后台任务在标签隐藏时必须撤销，不能留下定时器或继续占用请求许可',
);
hiddenNotificationController.destroy();
assert(
	hiddenNotificationActivityListeners.size === 0,
	'通知页面活跃监听必须随 application owner 释放',
);

let releaseNotificationTaxonomy: (() => void) | null = null;
let notificationOpenSettled = false;
const deferredTaxonomyController = new ReaderNotificationController({
	requests: {
		async load(group: ReaderNotificationGroupKey, page: number) {
			return Object.freeze({
				group,
				page,
				records: group === 'replies'
					? Object.freeze([warmReplyRecord])
					: Object.freeze([]),
				total: group === 'replies' ? 1 : 0,
				hasNext: false,
				nextCursor: null,
			});
		},
		async enrichTopicTaxonomy(pages) {
			await new Promise<void>((resolve) => {
				releaseNotificationTaxonomy = resolve;
			});
			return pages.map((page) => Object.freeze({
				...page,
				records: Object.freeze(page.records.map((record) => Object.freeze({
					...record,
					tags: Object.freeze(['late-taxonomy']),
				}))),
			}));
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	native,
	actions: {} as PostActionController,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
});
const deferredTaxonomyOpen = deferredTaxonomyController.open().then(() => {
	notificationOpenSettled = true;
});
await flushMicrotasks();
assert(
	notificationOpenSettled &&
	!deferredTaxonomyController.snapshot.loading &&
	deferredTaxonomyController.snapshot.records[0]?.tags.length === 0 &&
	releaseNotificationTaxonomy !== null,
	'通知正文完成后必须立即结束加载，不能等待 Topic 类别与标签补充请求',
);
releaseNotificationTaxonomy();
await deferredTaxonomyOpen;
await flushMicrotasks();
assert(
	deferredTaxonomyController.snapshot.records[0]?.tags.includes(
		'late-taxonomy',
	) === true,
	'通知 taxonomy 后台完成后必须回写当前列表与持久投影缓存',
);
deferredTaxonomyController.destroy();

const closedWarmCallbacks = new Map<number, () => void>();
const closedWarmLoads: string[] = [];
let closedWarmScheduleId = 0;
const closedWarmController = new ReaderNotificationController({
	requests: {
		async load(
			group: ReaderNotificationGroupKey,
			page: number,
			options?: Parameters<DiscourseNotificationRequestAdapter['load']>[2],
		) {
			closedWarmLoads.push(
				`${group}:${String(options?.background)}:${String(options?.history)}`,
			);
			return Object.freeze({
				group,
				page,
				records: group === 'replies'
					? Object.freeze([warmReplyRecord])
					: Object.freeze([]),
				total: group === 'replies' ? 1 : 0,
				hasNext: false,
				nextCursor: null,
			});
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	native,
	actions: {} as PostActionController,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	backgroundWarmDelayMs: 0,
	schedule(callback) {
		const id = ++closedWarmScheduleId;
		closedWarmCallbacks.set(id, callback);
		return id;
	},
	cancel(handle) {
		closedWarmCallbacks.delete(Number(handle));
	},
});
closedWarmController.startBackgroundCache();
await flushMicrotasks();
assert(
	closedWarmCallbacks.size === 1 &&
	closedWarmLoads.length === 0 &&
	!closedWarmController.snapshot.open,
	'application 启动后台消息缓存时只排入一个断点任务，不能同步阻塞页面或另起头页预热',
);
const closedWarmTask = closedWarmCallbacks.entries().next().value as
	| [number, () => void]
	| undefined;
assert(closedWarmTask !== undefined, '后台消息缓存必须存在首个预热任务');
closedWarmCallbacks.delete(closedWarmTask[0]);
closedWarmTask[1]();
await flushMicrotasks();
assert(
	!closedWarmController.snapshot.open &&
	closedWarmLoads.some((entry) => entry === 'replies:undefined:true') &&
	closedWarmController.cacheStats().records >= 1,
	'消息面板关闭时必须以 history 低优先级请求并保存归一化历史缓存',
);
closedWarmController.destroy();

const deferredIdentityNative = new FakeNotificationNative();
deferredIdentityNative.currentUsername = '';
const deferredWarmCallbacks = new Map<number, () => void>();
const deferredWarmLoads: string[] = [];
const deferredWarmErrors: unknown[] = [];
let deferredWarmScheduleId = 0;
const deferredWarmController = new ReaderNotificationController({
	requests: {
		async load(
			group: ReaderNotificationGroupKey,
			page: number,
			options?: Parameters<DiscourseNotificationRequestAdapter['load']>[2],
		) {
			deferredWarmLoads.push(
				`${group}:${page}:${String(options?.background)}`,
			);
			return {
				group,
				page,
				records: Object.freeze([]),
				total: 0,
				hasNext: false,
				nextCursor: null,
			};
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	native: deferredIdentityNative,
	actions: {} as PostActionController,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	backgroundWarmDelayMs: 0,
	schedule(callback) {
		const id = ++deferredWarmScheduleId;
		deferredWarmCallbacks.set(id, callback);
		return id;
	},
	cancel(handle) {
		deferredWarmCallbacks.delete(Number(handle));
	},
	onError(cause) {
		deferredWarmErrors.push(cause);
	},
});
assert(
	deferredWarmCallbacks.size === 0 &&
	deferredWarmLoads.length === 0,
	'登录身份未就绪且面板关闭时必须保持零通知请求',
);
await deferredWarmController.open();
for (let step = 0; step < 4; step += 1) {
	const scheduled = deferredWarmCallbacks.entries().next().value as
		| [number, () => void]
		| undefined;
	if (!scheduled) break;
	deferredWarmCallbacks.delete(scheduled[0]);
	scheduled[1]();
	await flushMicrotasks();
}
assert(
	deferredWarmLoads.join(',') ===
		'replies:0:undefined,likes:0:undefined,mentions:0:undefined,' +
		'edits:0:undefined,links:0:undefined,boosts:0:undefined,' +
		'reactions:0:undefined,other:0:undefined,all:0:true' &&
	deferredWarmErrors.length === 0,
	'用户显式打开面板后可读取公共通知，但身份未就绪时不得请求私信',
);
deferredWarmController.close();
deferredIdentityNative.currentUsername = 'viewer';
deferredIdentityNative.emitChanged();
await flushMicrotasks();
for (let step = 0; step < 4; step += 1) {
	const scheduled = deferredWarmCallbacks.entries().next().value as
		| [number, () => void]
		| undefined;
	if (!scheduled) break;
	deferredWarmCallbacks.delete(scheduled[0]);
	scheduled[1]();
	await flushMicrotasks();
}
assert(
	deferredWarmLoads.join(',') ===
		'replies:0:undefined,likes:0:undefined,mentions:0:undefined,' +
		'edits:0:undefined,links:0:undefined,boosts:0:undefined,' +
		'reactions:0:undefined,other:0:undefined,all:0:true,' +
		'replies:0:true,likes:0:true,mentions:0:true,' +
		'edits:0:true,links:0:true,boosts:0:true,reactions:0:true,' +
		'other:0:true,all:0:true,inbox:0:true' &&
	deferredWarmErrors.length === 0 &&
	deferredWarmCallbacks.size === 0,
	'关闭态原生变更只能即时刷新头页，不得续跑深历史回填：' +
		JSON.stringify({
			loads: deferredWarmLoads,
			errors: deferredWarmErrors.map((error) => String(error)),
			callbacks: deferredWarmCallbacks.size,
		}),
);
deferredWarmController.destroy();

const parallelHistoryCallbacks = new Map<
	number,
	Readonly<{ callback: () => void; delayMs: number }>
>();
const parallelHistoryLoads: Array<Readonly<{
	group: ReaderNotificationGroupKey;
	visible: boolean;
}>> = [];
const parallelHistoryResolvers: Array<() => void> = [];
let parallelHistoryScheduleId = 0;
let parallelHistoryActive = 0;
let parallelHistoryPeak = 0;
let holdParallelHistory = true;
const parallelHistoryController = new ReaderNotificationController({
	requests: {
		async load(
			group: ReaderNotificationGroupKey,
			page: number,
			options?: Parameters<DiscourseNotificationRequestAdapter['load']>[2],
		) {
			if (!options?.history) {
				return Object.freeze({
					group,
					page,
					records: Object.freeze([]),
					total: 200,
					hasNext: true,
					nextCursor: null,
				});
			}
			parallelHistoryLoads.push(Object.freeze({
				group,
				visible: options.visibleHistory === true,
			}));
			parallelHistoryActive += 1;
			parallelHistoryPeak = Math.max(
				parallelHistoryPeak,
				parallelHistoryActive,
			);
			if (holdParallelHistory) {
				await new Promise<void>((resolve) => {
					parallelHistoryResolvers.push(resolve);
				});
			}
			parallelHistoryActive -= 1;
			return Object.freeze({
				group,
				page,
				records: Object.freeze([]),
				total: 0,
				hasNext: false,
				nextCursor: null,
			});
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	native,
	actions: {} as PostActionController,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	backgroundWarmDelayMs: 0,
	historyStepDelayMs: 250,
	visibleHistoryConcurrency: 3,
	schedule(callback, delayMs) {
		const id = ++parallelHistoryScheduleId;
		parallelHistoryCallbacks.set(id, Object.freeze({ callback, delayMs }));
		return id;
	},
	cancel(handle) {
		parallelHistoryCallbacks.delete(Number(handle));
	},
});
await parallelHistoryController.open();
parallelHistoryController.startBackgroundCache();
await flushMicrotasks();
const firstParallelHistoryTask = parallelHistoryCallbacks.entries().next().value as
	| [number, Readonly<{ callback: () => void; delayMs: number }>]
	| undefined;
assert(firstParallelHistoryTask !== undefined, '可见通知历史必须排入快取任务');
parallelHistoryCallbacks.delete(firstParallelHistoryTask[0]);
firstParallelHistoryTask[1].callback();
await flushMicrotasks();
assert(
	parallelHistoryPeak === 3 &&
		parallelHistoryLoads.map((entry) => entry.group).join(',') ===
			'replies,likes,mentions' &&
		parallelHistoryLoads.every((entry) => entry.visible),
	'浮窗打开时必须并行快取三个不同活动来源，并将其提升到 surface-prefetch',
);
parallelHistoryResolvers.shift()?.();
await flushMicrotasks();
assert(
	parallelHistoryLoads.length === 4 &&
	parallelHistoryPeak === 3 &&
	parallelHistoryCallbacks.size === 0,
	'可见历史必须在单个槽位释放后立即补入下一来源，不能等待整批完成或重新排时器',
);
parallelHistoryController.close();
holdParallelHistory = false;
for (const resolve of parallelHistoryResolvers.splice(0)) resolve();
await flushMicrotasks();
const closedParallelHistoryTask = parallelHistoryCallbacks.entries().next().value as
	| [number, Readonly<{ callback: () => void; delayMs: number }>]
	| undefined;
assert(closedParallelHistoryTask !== undefined, '关闭后必须保留后台断点续传任务');
parallelHistoryCallbacks.delete(closedParallelHistoryTask[0]);
closedParallelHistoryTask[1].callback();
await flushMicrotasks();
assert(
	parallelHistoryLoads.length === 5 &&
		parallelHistoryLoads.at(-1)?.visible === false,
	'浮窗关闭后必须降回单来源 background 请求，不能保持可见并发优先级',
);
parallelHistoryController.destroy();

const historyCallbacks = new Map<
	number,
	Readonly<{ callback: () => void; delayMs: number }>
>();
const historyLoads: string[] = [];
let historyScheduleId = 0;
const historyController = new ReaderNotificationController({
	requests: {
		async load(
			group: ReaderNotificationGroupKey,
			page: number,
			options?: Parameters<DiscourseNotificationRequestAdapter['load']>[2],
		) {
			historyLoads.push([
				group,
				page,
				options?.history && options?.background
					? 'warm-history'
					: options?.history
						? 'history'
						: options?.background ? 'warm' : 'visible',
			].join(':'));
			if (group === 'all' || group === 'inbox') {
				return {
					group,
					page,
					records: Object.freeze([]),
					total: group === 'all' ? 8 : 0,
					hasNext: false,
					nextCursor: null,
				};
			}
			const record = normalizeUserActionNotification({
				action_type: group === 'replies' ? 6 : 2,
				post_id: 4_000 + page * 100 +
					READER_NOTIFICATION_AGGREGATE_GROUP_ORDER.indexOf(group),
				acting_user_id: 100 + page,
				acting_username: `${group}-${page}`,
				created_at: page === 0
					? '2026-07-30T02:00:00.000Z'
					: '2026-07-29T02:00:00.000Z',
				topic_id: 500 +
					READER_NOTIFICATION_AGGREGATE_GROUP_ORDER.indexOf(group),
				post_number: page + 2,
				title: `${group} 历史`,
				excerpt: page === 1 ? '深层回复命中' : `${group} 首屏`,
			}, group);
			return {
				group,
				page,
				records: Object.freeze([record]),
				total: group === 'replies' ? 2 : 1,
				hasNext: group === 'replies' && page === 0,
				nextCursor: null,
			};
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	native,
	actions: {} as PostActionController,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	backgroundWarmDelayMs: 0,
	historyStepDelayMs: 0,
	historyRetryDelayMs: 0,
	schedule(callback, delayMs) {
		const id = ++historyScheduleId;
		historyCallbacks.set(id, Object.freeze({ callback, delayMs }));
		return id;
	},
	cancel(handle) {
		historyCallbacks.delete(Number(handle));
	},
});
assert(
	historyCallbacks.size === 0 && historyLoads.length === 0,
	'消息面板关闭时不得创建深历史调度',
);
await historyController.open();
assert(
	historyCallbacks.size === 0,
	'打开消息面板只能读取当前缓存，不得启动渐进历史回填',
);
historyController.startBackgroundCache();
await flushMicrotasks();
assert(
	historyCallbacks.size > 0,
	'application 后台启动后必须排入渐进历史回填',
);
const callbacksBeforeClose = historyCallbacks.size;
historyController.close();
assert(
	historyCallbacks.size === callbacksBeforeClose &&
	historyController.snapshot.history.status !== 'paused',
	'关闭消息面板不得暂停或取消 application 深历史调度',
);
await historyController.open();
assert(
	historyCallbacks.size === callbacksBeforeClose,
	'重新打开消息面板不得重排 application 深历史任务',
);
const runHistoryCallback = async (): Promise<void> => {
	const entry = [...historyCallbacks][0];
	if (!entry) throw new Error('历史回填缺少调度任务');
	historyCallbacks.delete(entry[0]);
	entry[1].callback();
	await flushMicrotasks();
};
for (let step = 0; step < 4; step += 1) {
	if (historyController.snapshot.history.status === 'complete') break;
	await runHistoryCallback();
}
assert(
	historyLoads.filter((entry) => entry.endsWith(':history')).join(',') ===
		'replies:1:history' &&
	historyController.snapshot.history.status === 'complete' &&
	historyController.snapshot.history.completedGroups === 8 &&
	historyController.snapshot.history.loadedPages === 9 &&
	historyController.snapshot.history.cachedRecords === 9 &&
	historyController.snapshot.history.progress === 1,
	'历史回填必须从首屏水位续取唯一缺页，并完成八类统一进度与去重记录索引：' +
		JSON.stringify({
			loads: historyLoads,
			history: historyController.snapshot.history,
		}),
);
historyController.setQuery('深层回复命中');
assert(
	historyController.snapshot.records.length === 1 &&
	historyController.snapshot.records[0]?.group === 'replies' &&
	historyController.snapshot.records[0]?.excerpt === '深层回复命中',
	'全历史回填完成后，“全部”搜索必须覆盖已退出热分页缓存的深层逐条记录',
);
const localHistoryRecord = historyController.syncHistoryRecords()[0]!;
historyController.applySyncedHistoryRecords(Object.freeze([
	Object.freeze({
		...localHistoryRecord,
		identity: 'webdav-history:remote-only',
		sourceNotificationId: 9_999,
		read: false,
		summary: 'WebDAV 跨设备通知历史',
		searchText: 'webdav跨设备通知历史',
	}),
	Object.freeze({
		...localHistoryRecord,
		sourceNotificationId: 8_888,
		read: !localHistoryRecord.read,
		summary: '不应覆盖本机原生状态',
	}),
]));
const mergedHistoryRecords = historyController.syncHistoryRecords();
const restoredHistoryRecord = mergedHistoryRecords.find((entry) =>
	entry.identity === 'webdav-history:remote-only');
const preservedLocalHistoryRecord = mergedHistoryRecords.find((entry) =>
	entry.identity === localHistoryRecord.identity);
historyController.setQuery('webdav跨设备通知历史');
assert(
	restoredHistoryRecord?.read === null &&
	restoredHistoryRecord.sourceNotificationId === null &&
	preservedLocalHistoryRecord?.read === localHistoryRecord.read &&
	preservedLocalHistoryRecord?.sourceNotificationId ===
		localHistoryRecord.sourceNotificationId &&
	historyController.snapshot.records[0]?.identity ===
		'webdav-history:remote-only',
	'WebDAV 恢复记录必须进入全历史搜索；同身份本机记录的已读与 mutation 身份必须优先',
);
historyController.destroy();

const resilientHistoryCallbacks = new Map<
	number,
	Readonly<{ callback: () => void; delayMs: number }>
>();
const resilientHistoryLoads: string[] = [];
let resilientHistoryScheduleId = 0;
let resilientHistoryNow = 2_000;
let resilientRepliesAttempts = 0;
const resilientHistoryController = new ReaderNotificationController({
	requests: {
		async load(
			group: ReaderNotificationGroupKey,
			page: number,
			options?: Parameters<DiscourseNotificationRequestAdapter['load']>[2],
		) {
			resilientHistoryLoads.push([
				group,
				page,
				String(options?.history),
				String(options?.background),
			].join(':'));
			if (group === 'replies' && page === 1) {
				resilientRepliesAttempts += 1;
				if (resilientRepliesAttempts === 1) {
					throw new TypeError('Failed to fetch');
				}
			}
			const hasNext = page === 0 && (group === 'replies' || group === 'likes');
			return Object.freeze({
				group,
				page,
				records: Object.freeze([]),
				total: hasNext ? 2 : 0,
				hasNext,
				nextCursor: null,
			});
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	native,
	actions: {} as PostActionController,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	backgroundWarmDelayMs: 0,
	historyStepDelayMs: 250,
	historyRetryDelayMs: 120,
	now: () => resilientHistoryNow,
	schedule(callback, delayMs) {
		const id = ++resilientHistoryScheduleId;
		resilientHistoryCallbacks.set(id, Object.freeze({ callback, delayMs }));
		return id;
	},
	cancel(handle) {
		resilientHistoryCallbacks.delete(Number(handle));
	},
});
await resilientHistoryController.open();
resilientHistoryController.startBackgroundCache();
await flushMicrotasks();
const runResilientHistoryCallback = async (): Promise<void> => {
	const entry = [...resilientHistoryCallbacks][0];
	if (!entry) throw new Error('自愈历史回填缺少调度任务');
	resilientHistoryCallbacks.delete(entry[0]);
	entry[1].callback();
	await flushMicrotasks();
};
assert(
	[...resilientHistoryCallbacks.values()][0]?.delayMs === 250,
	'面板打开只回放投影，不能重排或提高 application 深历史任务优先级',
);
await runResilientHistoryCallback();
assert(
	resilientHistoryLoads.at(-1) === 'replies:1:true:undefined' &&
		[...resilientHistoryCallbacks.values()][0]?.delayMs === 250,
	'单个来源暂时失败后应保留后台优先级，并继续轮转其他可用来源',
);
await runResilientHistoryCallback();
const resilientSelfProgress = readerSelfObservationProjection({
	notifications: {
		snapshot: resilientHistoryController.snapshot,
		records: Object.freeze([]),
	},
}).streams[0];
assert(
	resilientHistoryLoads.at(-1) === 'likes:1:true:undefined' &&
		resilientHistoryController.snapshot.history.status === 'error' &&
		resilientHistoryController.snapshot.history.retryAt === 2_120 &&
		[...resilientHistoryCallbacks.values()][0]?.delayMs === 120 &&
		resilientSelfProgress?.status === 'loading' &&
		resilientSelfProgress.detail.includes('自动续传') &&
		resilientSelfProgress.error === '',
	'其余来源完成后，失败来源必须保留独立断点并自动安排到期续传',
);
resilientHistoryNow = 2_120;
await runResilientHistoryCallback();
assert(
	resilientHistoryLoads.at(-1) === 'replies:1:true:undefined' &&
	resilientRepliesAttempts === 2 &&
	String(resilientHistoryController.snapshot.history.status) === 'complete' &&
		resilientHistoryController.snapshot.history.completedGroups === 8 &&
		resilientHistoryCallbacks.size === 0,
	'失败来源到期后必须自行重新入队并完成，不能停在需要手工点击的重试状态',
);
resilientHistoryController.destroy();

const resumedHistoryCallbacks = new Map<
	number,
	Readonly<{ callback: () => void; delayMs: number }>
>();
const resumedHistoryCacheReads: string[] = [];
const resumedHistoryLoads: string[] = [];
const resumedHistoryWrites: string[] = [];
let resumedHistoryScheduleId = 0;
const resumedHistoryRecord = normalizeUserActionNotification({
	action_type: 6,
	post_id: 9_100,
	acting_user_id: 91,
	acting_username: 'checkpoint-user',
	created_at: '2026-07-28T02:00:00.000Z',
	topic_id: 910,
	post_number: 2,
	title: '持久断点通知',
	excerpt: '已提交四页',
}, 'replies');
const resumedHistoryController = new ReaderNotificationController({
	requests: {
		async loadCached(group: ReaderNotificationGroupKey, page: number) {
			resumedHistoryCacheReads.push(`${group}:${page}`);
			return group === 'replies' && page === 4
				? Object.freeze({
					group,
					page,
					records: Object.freeze([]),
					total: 150,
					hasNext: true,
					nextCursor: null,
				})
				: null;
		},
		async load(
			group: ReaderNotificationGroupKey,
			page: number,
			options?: Parameters<DiscourseNotificationRequestAdapter['load']>[2],
		) {
			resumedHistoryLoads.push(`${group}:${page}:${String(options?.history)}`);
			return Object.freeze({
				group,
				page,
				records: Object.freeze([]),
				total: 150,
				hasNext: false,
				nextCursor: null,
			});
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	projection: {
		async read(group) {
			return group === 'replies'
				? Object.freeze({
					records: Object.freeze([resumedHistoryRecord]),
					totalHint: 150,
					complete: false,
					updatedAt: 1_900,
					sourceNextPage: 4,
					sourcePageSize: 100,
				})
				: Object.freeze({
					records: Object.freeze([]),
					totalHint: 0,
					complete: true,
					updatedAt: 1_900,
				});
		},
		async write(group, _records, options) {
			resumedHistoryWrites.push(`${group}:${String(options?.sourceNextPage)}`);
		},
	},
	native,
	actions: {} as PostActionController,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	backgroundWarmDelayMs: 0,
	historyStepDelayMs: 250,
	schedule(callback, delayMs) {
		const id = ++resumedHistoryScheduleId;
		resumedHistoryCallbacks.set(id, Object.freeze({ callback, delayMs }));
		return id;
	},
	cancel(handle) {
		resumedHistoryCallbacks.delete(Number(handle));
	},
});
resumedHistoryController.startBackgroundCache();
await flushMicrotasks();
const resumedHistoryEntry = [...resumedHistoryCallbacks][0];
assert(
	resumedHistoryEntry?.[1].delayMs === 250 &&
		resumedHistoryController.snapshot.history.loadedPages === 11 &&
		resumedHistoryController.snapshot.history.progress === 7 / 8 &&
		resumedHistoryLoads.length === 0,
	'恢复归一投影时必须同时恢复七个完整来源和未完成来源的四页水位；进度只按固定来源完成数计算，不能先重放旧请求',
);
resumedHistoryCallbacks.delete(resumedHistoryEntry[0]);
resumedHistoryEntry[1].callback();
await flushMicrotasks();
assert(
	resumedHistoryCacheReads.join(',') === 'replies:4' &&
		resumedHistoryLoads.length === 0 &&
		resumedHistoryWrites.includes('replies:5') &&
		[...resumedHistoryCallbacks.values()][0]?.delayMs === 0,
	'后台续传必须先直接消费水位后的持久原始页，缓存命中不得联网或叠加步进等待',
);
const resumedNetworkEntry = [...resumedHistoryCallbacks][0]!;
resumedHistoryCallbacks.delete(resumedNetworkEntry[0]);
resumedNetworkEntry[1].callback();
await flushMicrotasks();
assert(
	resumedHistoryCacheReads.join(',') === 'replies:4,replies:5' &&
		resumedHistoryLoads.join(',') === 'replies:5:true' &&
		resumedHistoryWrites.includes('replies:6') &&
		resumedHistoryController.snapshot.history.status === 'complete',
	'只有持久缓存之后的真实缺页才可进入后台网络，并在提交后推进新水位',
);
resumedHistoryController.destroy();

const corruptCheckpointCallbacks = new Map<
	number,
	Readonly<{ callback: () => void; delayMs: number }>
>();
const corruptCheckpointWrites: Array<Readonly<{
	complete: boolean;
	sourceNextPage: number | undefined;
	sourceOffset: number | undefined;
	checkpointMode: string | undefined;
}>> = [];
const corruptCheckpointLoads: number[] = [];
const corruptCheckpointResolvers: Array<() => void> = [];
let corruptCheckpointScheduleId = 0;
let corruptCheckpointActive = 0;
let corruptCheckpointPeak = 0;
let corruptRepliesProjection = Object.freeze({
	records: Object.freeze([resumedHistoryRecord]),
	totalHint: 200,
	complete: true,
	updatedAt: 2_100,
	sourceNextPage: 6,
	sourcePageSize: 100,
	sourceOffset: 600,
});
const corruptCheckpointController = new ReaderNotificationController({
	requests: {
		async loadCached(): Promise<null> {
			return null;
		},
		async load(
			group: ReaderNotificationGroupKey,
			page: number,
			options?: Parameters<DiscourseNotificationRequestAdapter['load']>[2],
		) {
			if (!options?.history) {
				return Object.freeze({
					group,
					page,
					records: Object.freeze([]),
					total: 0,
					hasNext: false,
					nextCursor: null,
				});
			}
			corruptCheckpointLoads.push(page);
			corruptCheckpointActive += 1;
			corruptCheckpointPeak = Math.max(
				corruptCheckpointPeak,
				corruptCheckpointActive,
			);
			await new Promise<void>((resolve) => {
				corruptCheckpointResolvers.push(resolve);
			});
			corruptCheckpointActive -= 1;
			return Object.freeze({
				group,
				page,
				records: Object.freeze([]),
				total: 600,
				hasNext: page < 5,
				nextCursor: null,
			});
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	projection: {
		async read(group) {
			return group === 'replies'
				? corruptRepliesProjection
				: Object.freeze({
					records: Object.freeze([]),
					totalHint: 0,
					complete: true,
					updatedAt: 2_100,
					sourceNextPage: 1,
				});
		},
		async write(group, records, options) {
			if (group !== 'replies') return;
			corruptCheckpointWrites.push(Object.freeze({
				complete: options?.complete === true,
				sourceNextPage: options?.sourceNextPage,
				sourceOffset: options?.sourceOffset,
				checkpointMode: options?.checkpointMode,
			}));
			corruptRepliesProjection = Object.freeze({
				records: Object.freeze([...records]),
				totalHint: Math.max(records.length, options?.totalHint ?? 0),
				complete: options?.complete === true,
				updatedAt: options?.updatedAt ?? 2_100,
				sourceNextPage: options?.sourceNextPage ?? 0,
				sourcePageSize: options?.sourcePageSize ?? 100,
				sourceOffset: options?.sourceOffset ?? 0,
			});
		},
	},
	native,
	actions: {} as PostActionController,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	backgroundWarmDelayMs: 0,
	historyStepDelayMs: 0,
	visibleHistoryConcurrency: 3,
	schedule(callback, delayMs) {
		const id = ++corruptCheckpointScheduleId;
		corruptCheckpointCallbacks.set(id, Object.freeze({ callback, delayMs }));
		return id;
	},
	cancel(handle) {
		corruptCheckpointCallbacks.delete(Number(handle));
	},
});
corruptCheckpointController.startBackgroundCache();
await flushMicrotasks();
assert(
	corruptCheckpointWrites[0]?.checkpointMode === 'replace' &&
	corruptCheckpointWrites[0]?.complete === false &&
	corruptCheckpointWrites[0]?.sourceNextPage === 0 &&
	corruptCheckpointWrites[0]?.sourceOffset === 0 &&
	corruptCheckpointController.snapshot.history.status !== 'complete',
	'声明 offset 600 却只有 100 条的残缺完成投影必须保留记录并重置断点，不能继续显示历史已到底',
);
await corruptCheckpointController.open();
for (let step = 0; step < 8 && corruptCheckpointLoads.length < 3; step += 1) {
	const corruptCheckpointTask = [...corruptCheckpointCallbacks][0];
	assert(
		corruptCheckpointTask !== undefined,
		'修复后的残缺通知必须立即排入续传：' + JSON.stringify({
			history: corruptCheckpointController.snapshot.history,
			loads: corruptCheckpointLoads,
			writes: corruptCheckpointWrites,
		}),
	);
	corruptCheckpointCallbacks.delete(corruptCheckpointTask[0]);
	corruptCheckpointTask[1].callback();
	await flushMicrotasks();
}
assert(
	corruptCheckpointLoads.join(',') === '0,1,2' &&
	corruptCheckpointPeak === 3,
	'浮窗可见时，已知残缺水位的 user_actions 缺页必须在中央并发预算内并行补取',
);
for (const resolve of corruptCheckpointResolvers.splice(0)) resolve();
await flushMicrotasks();
corruptCheckpointController.destroy();

let releaseStartupProjectionRestore!: () => void;
const startupProjectionRestore = new Promise<void>((resolve) => {
	releaseStartupProjectionRestore = resolve;
});
const startupProjectionWrites: Array<Readonly<{
	group: string;
	complete: boolean;
	sourceNextPage: number | undefined;
}>> = [];
const startupProjectionController = new ReaderNotificationController({
	requests: {
		async load(): Promise<never> {
			throw new Error('完整启动投影恢复后不应请求网络');
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	projection: {
		async read(group) {
			await startupProjectionRestore;
			return Object.freeze({
				records: group === 'replies'
					? Object.freeze([resumedHistoryRecord])
					: Object.freeze([]),
				totalHint: group === 'replies' ? 150 : 0,
				complete: true,
				updatedAt: 2_000,
				sourceNextPage: group === 'replies' ? 3 : 1,
			});
		},
		async write(group, _records, options) {
			startupProjectionWrites.push(Object.freeze({
				group,
				complete: options?.complete === true,
				sourceNextPage: options?.sourceNextPage,
			}));
		},
	},
	native,
	actions: {} as PostActionController,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	backgroundWarmDelayMs: 0,
});
startupProjectionController.startBackgroundCache();
startupProjectionController.applySyncedHistoryRecords(Object.freeze([
	resumedHistoryRecord,
]));
await flushMicrotasks();
assert(
	startupProjectionWrites.length === 0,
	'启动投影尚未恢复完成时，晚到同步记录不得把未知内存状态写成未完成并覆盖持久完成断点',
);
releaseStartupProjectionRestore();
await flushMicrotasks();
const startupSourceWrites = startupProjectionWrites.filter((entry) =>
	READER_NOTIFICATION_AGGREGATE_GROUP_ORDER.includes(
		entry.group as ReaderNotificationGroupKey,
	));
assert(
	startupSourceWrites.length === 8 &&
		startupSourceWrites.every((entry) => entry.complete) &&
		startupSourceWrites.find((entry) => entry.group === 'replies')
			?.sourceNextPage === 3 &&
		startupProjectionController.snapshot.history.status === 'complete' &&
		startupProjectionController.snapshot.history.loadedPages === 10,
	'启动恢复完成后必须合并并刷新待写投影，同时保留八个来源的完成状态与真实终止页水位',
);
startupProjectionController.destroy();

const deepAggregateLoads: string[] = [];
let deepAggregateScheduleId = 0;
const deepAggregateController = new ReaderNotificationController({
	requests: {
		async load(
			group: ReaderNotificationGroupKey,
			page: number,
			options?: Parameters<DiscourseNotificationRequestAdapter['load']>[2],
		) {
			deepAggregateLoads.push([
				group,
				page,
				options?.history ? 'history' : 'visible',
			].join(':'));
			return {
				group,
				page,
				records: Object.freeze([]),
				total: 1_000,
				hasNext: true,
				nextCursor: null,
			};
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	native,
	actions: {} as PostActionController,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	backgroundWarmDelayMs: 60_000,
	schedule() {
		return ++deepAggregateScheduleId;
	},
	cancel() {},
});
await deepAggregateController.open();
deepAggregateController.applySyncedHistoryRecords(Object.freeze(
	Array.from({ length: 400 }, (_, index) => normalizeUserActionNotification({
		action_type: 6,
		post_id: 20_000 + index,
		acting_user_id: 30_000 + index,
		acting_username: `deep-${index}`,
		created_at: new Date(
			Date.UTC(2026, 6, 30, 3, 0) - index * 60_000,
		).toISOString(),
		topic_id: 40_000 + index,
		post_number: 2,
		title: `深层通知 ${index}`,
	}, 'replies')),
));
const deepAggregateLoadsBeforePaging = deepAggregateLoads.length;
for (let page = 1; page < 16; page += 1) {
	await deepAggregateController.nextPage();
}
assert(
	deepAggregateLoads.length === deepAggregateLoadsBeforePaging &&
		deepAggregateController.snapshot.page === 15 &&
		deepAggregateController.snapshot.records.length === 24 &&
		deepAggregateController.snapshot.total === 400 &&
		deepAggregateController.snapshot.totalPages === 17,
	'“全部”深页必须只切本地历史索引，翻到第 16 页不得按八类从头扇出前台请求',
);
deepAggregateController.destroy();

let releasePagingRefresh = (): void => {
	throw new Error('分页刷新请求尚未进入 pending');
};
const pagingRefreshGate = new Promise<void>((resolve) => {
	releasePagingRefresh = resolve;
});
let blockPagingRefresh = false;
let pagingScheduleId = 0;
const pagingRaceController = new ReaderNotificationController({
	requests: {
		async load(group: ReaderNotificationGroupKey, page: number) {
			if (blockPagingRefresh) await pagingRefreshGate;
			return {
				group,
				page,
				records: Object.freeze([]),
				total: 0,
				hasNext: false,
				nextCursor: null,
			};
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	native,
	actions: {} as PostActionController,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	backgroundWarmDelayMs: 60_000,
	schedule() {
		return ++pagingScheduleId;
	},
	cancel() {},
});
await pagingRaceController.open();
const pagingRaceHistory = Object.freeze(Array.from(
	{ length: 72 },
	(_, index) => normalizeUserActionNotification({
		action_type: 6,
		post_id: 110_000 + index,
		acting_user_id: 120_000 + index,
		acting_username: `paging-race-${index}`,
		created_at: new Date(
			Date.UTC(2026, 6, 30, 5, 0) - index * 60_000,
		).toISOString(),
		topic_id: 130_000 + index,
		post_number: 2,
		title: `分页竞态 ${index}`,
	}, 'replies')),
);
pagingRaceController.applySyncedHistoryRecords(pagingRaceHistory);
blockPagingRefresh = true;
const pagingRefresh = pagingRaceController.refresh();
await flushMicrotasks();
const pagingNavigation = pagingRaceController.nextPage();
await flushMicrotasks();
assert(
	pagingRaceController.snapshot.page === 1 &&
		pagingRaceController.snapshot.loading === true,
	'前台刷新占用请求槽时，下一页必须先进入等待缓存的 loading 状态',
);
pagingRaceController.applySyncedHistoryRecords(pagingRaceHistory);
assert(
	pagingRaceController.snapshot.page === 1 &&
		pagingRaceController.snapshot.loading === false &&
		pagingRaceController.snapshot.records.length === 24 &&
		pagingRaceController.snapshot.totalPages === 3,
	'后台历史先补齐当前页后必须立即释放 loading，恢复左右分页按钮交互',
);
releasePagingRefresh();
await Promise.all([pagingRefresh, pagingNavigation]);
pagingRaceController.destroy();

const stickyTabLoads: string[] = [];
let stickyTabScheduleId = 0;
const stickyTabController = new ReaderNotificationController({
	requests: {
		async load(
			group: ReaderNotificationGroupKey,
			page: number,
			options?: Parameters<DiscourseNotificationRequestAdapter['load']>[2],
		) {
			stickyTabLoads.push([
				group,
				page,
				options?.background ? 'background' : 'visible',
			].join(':'));
			if (group === 'all') {
				return {
					group,
					page,
					records: Object.freeze([]),
					total: 0,
					hasNext: false,
					nextCursor: null,
				};
			}
			const record = normalizeUserActionNotification({
				action_type: group === 'likes' ? 2 : 6,
				post_id: 70_000 + page * 100 +
					READER_NOTIFICATION_GROUP_ORDER.indexOf(group),
				acting_user_id: 80_000 + page,
				acting_username: `${group}-${page}`,
				created_at: new Date(
					Date.UTC(2026, 6, 30, 4, 0) - page * 60_000,
				).toISOString(),
				topic_id: 90_000 +
					READER_NOTIFICATION_GROUP_ORDER.indexOf(group),
				post_number: page + 2,
				title: `${group} 缓存页 ${page}`,
			}, group);
			return {
				group,
				page,
				records: Object.freeze([record]),
				total: group === 'replies' ? 120 : 1,
				hasNext: group === 'replies' && page < 3,
				nextCursor: null,
			};
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	native,
	actions: {} as PostActionController,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	maxCachedPages: 10,
	backgroundWarmDelayMs: 60_000,
	openRevalidateMs: 60_000,
	now: () => 1_000,
	schedule() {
		return ++stickyTabScheduleId;
	},
	cancel() {},
});
await stickyTabController.open();
await stickyTabController.selectGroup('replies');
await stickyTabController.nextPage();
await stickyTabController.nextPage();
await stickyTabController.nextPage();
const stickyLikesLoads = stickyTabLoads.filter((entry) =>
	entry.startsWith('likes:0:')).length;
const stickyLikesSelection = stickyTabController.selectGroup('likes');
assert(
	stickyTabController.snapshot.records[0]?.group === 'likes',
	'历史深页挤满热缓存后，切换子 tab 也必须同步回放已缓存头页',
);
await stickyLikesSelection;
assert(
	stickyTabLoads.filter((entry) => entry.startsWith('likes:0:')).length ===
		stickyLikesLoads &&
		stickyTabController.cacheStats().pages <= 10,
	'子 tab 头页命中不得重复请求，热缓存仍必须遵守页数上限',
);
stickyTabController.destroy();

const fastNativeRecord = normalizeNativeNotification({
	id: 901,
	notification_type: 1,
	read: false,
	created_at: '2026-07-30T01:00:00.000Z',
	topic_id: 42,
	post_number: 3,
	data: { display_username: 'alice', topic_title: '测试主题' },
}, {
	actor: 'alice',
	typeName: 'replied',
	typeLabel: '回复',
	topicId: 42,
	postNumber: 3,
}, 'all');
const fastSyntheticRecord = normalizeUserActionNotification({
	action_type: 6,
	post_id: 300,
	acting_user_id: 9,
	acting_username: 'alice',
	created_at: '2026-07-30T01:00:00.000Z',
	topic_id: 42,
	post_number: 3,
	title: '测试主题',
}, 'replies');
const fastLoads: string[] = [];
let fastScheduleId = 0;
const fastCategoryController = new ReaderNotificationController({
	requests: {
		authScope: 'account:test',
		async load(
			group: ReaderNotificationGroupKey,
			page: number,
			options?: Parameters<DiscourseNotificationRequestAdapter['load']>[2],
		) {
			fastLoads.push([
				group,
				options?.background === true ? 'background' : 'foreground',
				String(options?.expandConsolidated),
			].join(':'));
			const records = group === 'all'
				? Object.freeze([fastNativeRecord])
				: group === 'replies'
					? Object.freeze([fastSyntheticRecord])
					: Object.freeze([]);
			return {
				group,
				page,
				records,
				total: records.length,
				hasNext: false,
				nextCursor: null,
			};
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	native,
	actions: {} as PostActionController,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	backgroundWarmDelayMs: 60_000,
	openRevalidateMs: 60_000,
	schedule() {
		return ++fastScheduleId;
	},
	cancel() {},
});
await fastCategoryController.open();
fastLoads.length = 0;
await fastCategoryController.selectGroup('replies');
assert(
	fastCategoryController.snapshot.group === 'replies' &&
		fastCategoryController.snapshot.records[0]?.identity ===
			fastSyntheticRecord.identity &&
		fastCategoryController.snapshot.records[0]?.sourceNotificationId === 901 &&
		fastLoads.length === 0,
	'聚合头页已缓存分类结果和已读身份时，首次切换分类也必须零请求回放',
);
fastCategoryController.destroy();

const rapidGroupRecords = new Map<
	ReaderNotificationGroupKey,
	ReturnType<typeof normalizeUserActionNotification>
>([
	['replies', normalizeUserActionNotification({
		action_type: 6,
		post_id: 41_001,
		acting_user_id: 51_001,
		acting_username: 'rapid-reply',
		created_at: '2026-07-30T03:01:00.000Z',
		topic_id: 61_001,
		post_number: 2,
		title: '快速点击回复',
	}, 'replies')],
	['likes', normalizeUserActionNotification({
		action_type: 2,
		post_id: 41_002,
		acting_user_id: 51_002,
		acting_username: 'rapid-like',
		created_at: '2026-07-30T03:02:00.000Z',
		topic_id: 61_002,
		post_number: 2,
		title: '快速点击点赞',
	}, 'likes')],
	['mentions', normalizeUserActionNotification({
		action_type: 7,
		post_id: 41_003,
		acting_user_id: 51_003,
		acting_username: 'rapid-mention',
		created_at: '2026-07-30T03:03:00.000Z',
		topic_id: 61_003,
		post_number: 2,
		title: '快速点击提及',
	}, 'mentions')],
]);
const rapidGroupLoads: ReaderNotificationGroupKey[] = [];
let releaseRapidFirstLoad = (): void => {
	throw new Error('快速点击首个请求尚未进入 pending');
};
const rapidFirstLoad = new Promise<void>((resolve) => {
	releaseRapidFirstLoad = resolve;
});
let rapidScheduleId = 0;
const rapidGroupController = new ReaderNotificationController({
	requests: {
		async load(group: ReaderNotificationGroupKey, page: number) {
			rapidGroupLoads.push(group);
			if (rapidGroupLoads.length === 1) await rapidFirstLoad;
			const record = rapidGroupRecords.get(group);
			const records = record ? Object.freeze([record]) : Object.freeze([]);
			return {
				group,
				page,
				records,
				total: records.length,
				hasNext: false,
				nextCursor: null,
			};
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	native,
	actions: {} as PostActionController,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	backgroundWarmDelayMs: 60_000,
	schedule() {
		return ++rapidScheduleId;
	},
	cancel() {},
});
const rapidReplySelection = rapidGroupController.selectGroup('replies');
await flushMicrotasks();
const rapidLikeSelection = rapidGroupController.selectGroup('likes');
const rapidMentionSelection = rapidGroupController.selectGroup('mentions');
await flushMicrotasks();
const rapidLoadsWhileBlocked = rapidGroupLoads.join(',');
assert(
	rapidGroupController.snapshot.group === 'mentions' &&
		rapidGroupController.snapshot.loading &&
		rapidGroupController.snapshot.records.length === 0,
	'最终分类等待旧请求释放时必须保持加载态，不能把尚未读取误报为暂无消息',
);
releaseRapidFirstLoad();
await Promise.all([
	rapidReplySelection,
	rapidLikeSelection,
	rapidMentionSelection,
]);
assert(
	rapidLoadsWhileBlocked === 'replies' &&
		rapidGroupLoads.join(',') === 'replies,mentions' &&
		rapidGroupController.snapshot.group === 'mentions' &&
		rapidGroupController.snapshot.records[0]?.group === 'mentions',
	'快速连续切换必须串行请求且只保留最终意图，中间分类不得进入请求流',
);
rapidGroupController.destroy();

let normalizedProjectionNetworkLoads = 0;
const normalizedProjectedReplies = Object.freeze(Array.from(
	{ length: 40 },
	(_, index) => Object.freeze({
		...rapidGroupRecords.get('replies')!,
		identity: `projected-reply:${index + 1}`,
		createdAt: new Date(
			Date.parse('2026-07-30T03:01:00.000Z') - index * 1_000,
		).toISOString(),
	}),
));
const normalizedProjectionController = new ReaderNotificationController({
	requests: {
		async load(): Promise<never> {
			normalizedProjectionNetworkLoads += 1;
			throw new Error('归一投影命中后不应进入网络');
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	projection: {
		async read(group) {
			if (group === 'replies') {
				return Object.freeze({
					records: normalizedProjectedReplies,
					totalHint: normalizedProjectedReplies.length,
					complete: true,
					updatedAt: Date.now(),
					sourceNextPage: 3,
				});
			}
			return READER_NOTIFICATION_AGGREGATE_GROUP_ORDER.includes(
				group as ReaderNotificationGroupKey,
			) ? Object.freeze({
				records: Object.freeze([]),
				totalHint: 0,
				complete: true,
				updatedAt: Date.now(),
				sourceNextPage: 1,
			}) : null;
		},
		async write(): Promise<void> {},
	},
	native,
	actions: {} as PostActionController,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	backgroundWarmDelayMs: 60_000,
	openRevalidateMs: 60_000,
});
await normalizedProjectionController.selectGroup('replies');
await normalizedProjectionController.open();
normalizedProjectionController.close();
await normalizedProjectionController.open();
normalizedProjectionController.startBackgroundCache();
await flushMicrotasks();
assert(
	normalizedProjectionController.snapshot.records[0]?.identity ===
		normalizedProjectedReplies[0]?.identity &&
		normalizedProjectionController.snapshot.records.length ===
			normalizedProjectedReplies.length &&
		normalizedProjectionController.syncHistoryRecords().length === 40 &&
	normalizedProjectionController.cacheStats().records === 40 &&
	normalizedProjectionNetworkLoads === 4 &&
	normalizedProjectionController.snapshot.history.status === 'complete' &&
	normalizedProjectionController.snapshot.history.loadedPages === 10,
	'通知必须先恢复完整账号归一分页投影；重复打开仍立即校验头部且失败不得清空投影：' +
		JSON.stringify({
			first: normalizedProjectionController.snapshot.records[0]?.identity,
			visible: normalizedProjectionController.snapshot.records.length,
			history: normalizedProjectionController.syncHistoryRecords().length,
			cached: normalizedProjectionController.cacheStats().records,
			network: normalizedProjectionNetworkLoads,
		}),
);
normalizedProjectionController.destroy();

const nonRegressingProjectionRecords = Object.freeze(Array.from(
	{ length: 3 },
	(_, index) => normalizeUserActionNotification({
		action_type: 6,
		post_id: 45_000 + index,
		acting_user_id: 46_000 + index,
		acting_username: `projection-user-${index}`,
		created_at: `2026-08-17T0${index}:00:00.000Z`,
		topic_id: 47_000 + index,
		post_number: 2,
		title: `投影历史 ${index + 1}`,
	}, 'replies'),
));
let freshProjectionRecords = nonRegressingProjectionRecords;
const nonRegressingProjectionController = new ReaderNotificationController({
	requests: {
		async load(): Promise<never> {
			throw new Error('完整投影恢复不得触发网络');
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	projection: {
		async read(group) {
			const records = group === 'replies'
				? freshProjectionRecords
				: Object.freeze([]);
			return Object.freeze({
				records,
				totalHint: records.length,
				complete: true,
				updatedAt: 1_000,
				sourceNextPage: 1,
			});
		},
		async write(): Promise<void> {},
	},
	native,
	actions: {} as PostActionController,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	backgroundWarmDelayMs: 60_000,
});
nonRegressingProjectionController.startBackgroundCache();
await flushMicrotasks();
assert(
	nonRegressingProjectionController.snapshot.history.cachedRecords === 3 &&
		nonRegressingProjectionController.snapshot.groupCounts.get('replies') === 3,
	'通知后台启动必须先恢复完整持久投影',
);
freshProjectionRecords = Object.freeze([nonRegressingProjectionRecords[0]!]);
await nonRegressingProjectionController.reloadExternalProjection();
assert(
	nonRegressingProjectionController.snapshot.history.cachedRecords === 3 &&
		nonRegressingProjectionController.snapshot.groupCounts.get('replies') === 3,
	'fresh 部分快照必须与本机完整活动历史合并，刷新期间缓存和分类计数不得回退',
);
nonRegressingProjectionController.destroy();

const incompleteGateway = new FakeGateway();
const incompleteAjax: ReaderNotificationNativeAjaxPort = {
	nativeBinding: 'discourse/lib/ajax#ajax',
	async request<T>(
		input: Parameters<ReaderNotificationNativeAjaxPort['request']>[0],
	): Promise<RequestTransportResponse<T>> {
		const value = input.path.startsWith('/t/42.json?post_number=3')
			? {
				post_stream: {
					posts: [{
						post_number: 3,
						reply_to_post_number: 1,
						username: 'alice',
					}],
				},
			}
			: payloadFor(input.path);
		return { ok: true, status: 200, value: value as T };
	},
};
const incompleteRequests = new DiscourseNotificationRequestAdapter({
	gateway: incompleteGateway,
	ajax: incompleteAjax,
	native,
	authScope: 'account:test',
	signal: abort.signal,
	replyExpansionCache: {
		kind: 'discourse-topic-posts',
		tags: ['notifications'],
		freshForMs: 60_000,
		retainForMs: 86_400_000,
		persist: true,
	},
});
const incompletePage = await incompleteRequests.load('all', 0);
assert(
	incompletePage.records.length === 1 &&
		incompletePage.records[0]?.identity === 'notification:501' &&
		incompletePage.records[0]?.group === 'replies' &&
		incompletePage.records[0]?.aggregateCount === 2 &&
		incompletePage.records[0]?.actor === 'alice' &&
		incompletePage.records[0]?.avatarFallback === '2' &&
		incompletePage.records[0]?.avatarTemplate === '' &&
		incompletePage.records[0]?.summary ===
			'@alice 等 · 2 条回复 · 测试主题',
	'合并回复补载不完整时必须保留一个语义完整的聚合记录，不能显示伪用户名或半棵记录',
);

const mutationDescriptors: ActionMutationDescriptor<unknown>[] = [];
let deferMarkAll = false;
let deferSingleMark = false;
let resolveMarkAllMutation = (): void => {
	throw new Error('全部已读 mutation 尚未进入 pending');
};
let resolveSingleMarkMutation = (): void => {
	throw new Error('单条已读 mutation 尚未进入 pending');
};
const actions = new PostActionController({
	mutation: {
		authScope: 'account:test',
		async execute<T>(descriptor: ActionMutationDescriptor<T>): Promise<T> {
			mutationDescriptors.push(descriptor);
			if (
				deferMarkAll &&
				descriptor.operation === 'notification-mark-read' &&
				descriptor.targetType === 'notification-group'
			) {
					await new Promise<void>((resolve) => {
						resolveMarkAllMutation = resolve;
					});
				}
				if (
					deferSingleMark &&
					descriptor.operation === 'notification-mark-read' &&
					descriptor.targetType === 'notification'
				) {
					await new Promise<void>((resolve) => {
						resolveSingleMarkMutation = resolve;
					});
				}
				return undefined as T;
		},
	},
	cache: {
		async invalidate(): Promise<void> {},
	},
});
const retryPage = await requests.load('all', 0);
let retryLoads = 0;
const retryDelays: number[] = [];
const retryingStates: boolean[] = [];
const retryController = new ReaderNotificationController({
	requests: {
		authScope: requests.authScope,
		async load() {
			retryLoads += 1;
			if (retryLoads === 1) throw new TypeError('Failed to fetch');
			return Object.freeze({ ...retryPage, group: 'replies' as const });
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	native,
	actions,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	delay: async (delayMs) => {
		retryDelays.push(delayMs);
	},
});
retryController.changes.subscribe((snapshot) => {
	retryingStates.push(snapshot.retrying);
});
await retryController.selectGroup('replies');
assert(
	retryLoads === 2 &&
	retryDelays.join(',') === '600' &&
	retryingStates.includes(true) &&
	retryController.snapshot.records.length === retryPage.records.length,
	'通知网络/超时/5xx 故障必须显示重试态并仅自动重试一次',
);
retryController.destroy();

const optimisticNative = new FakeNotificationNative();
optimisticNative.unread = 1;
const optimisticPage = Object.freeze({
	...retryPage,
	records: Object.freeze([retryPage.records[0]!] as const),
	total: 1,
});
const optimisticController = new ReaderNotificationController({
	requests: {
		authScope: requests.authScope,
		async load() {
			return optimisticPage;
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	native: optimisticNative,
	actions,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
});
await optimisticController.open();
deferSingleMark = true;
const pendingSingleMark = optimisticController.markRecordRead(
	optimisticController.snapshot.records[0]!,
);
await flushMicrotasks();
assert(
	optimisticController.snapshot.records[0]?.read === true &&
		optimisticNative.readCommits === 0,
	'单条通知点击必须先即时更新统一已读状态，不能等待网络 mutation 返回',
);
resolveSingleMarkMutation();
await pendingSingleMark;
deferSingleMark = false;
assert(
	Number(optimisticNative.readCommits) === 1 &&
		optimisticController.snapshot.unreadCount === 0,
	'单条已读 mutation 成功后必须提交 current-user 计数并保留即时状态',
);
optimisticController.destroy();

let rateLimitLoads = 0;
let rateLimitDelays = 0;
let rateLimitScheduleId = 0;
const rateLimitSchedules = new Map<
	number,
	Readonly<{ callback: () => void; delayMs: number }>
>();
const rateLimitController = new ReaderNotificationController({
	requests: {
		authScope: requests.authScope,
		async load(group: ReaderNotificationGroupKey) {
			if (group === 'all') return retryPage;
			rateLimitLoads += 1;
			throw Object.assign(new Error('Too Many Requests'), { status: 429 });
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	native,
	actions,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	delay: async () => {
		rateLimitDelays += 1;
	},
	now: () => 1_000,
	activity: {
		visible: () => true,
		subscribe: () => () => {},
	},
	nativePollIntervalMs: 20_000,
	schedule(callback, delayMs) {
		const id = ++rateLimitScheduleId;
		rateLimitSchedules.set(id, Object.freeze({ callback, delayMs }));
		return id;
	},
	cancel(handle) {
		rateLimitSchedules.delete(Number(handle));
	},
});
await rateLimitController.selectGroup('replies');
await rateLimitController.open();
assert(
	rateLimitLoads === 1 &&
	rateLimitDelays === 0 &&
	[...rateLimitSchedules.values()].every((entry) => entry.delayMs >= 60_000) &&
	(rateLimitController.snapshot.error as { status?: number } | null)?.status ===
		429,
	'429 不得本地即时重试；冷却期内再次打开也不能出网，并至少退避 60 秒',
);
await rateLimitController.selectGroup('likes');
assert(
	rateLimitLoads === 1 &&
	rateLimitController.snapshot.group === 'likes' &&
	!rateLimitController.snapshot.loading &&
	(rateLimitController.snapshot.error as { status?: number } | null)?.status ===
		429,
	'429 冷却期切换分类或深页必须退出加载态并等待自动重试，不能永久自锁',
);
rateLimitController.destroy();

let activityVisible = true;
const activityListeners = new Set<() => void>();
const activitySchedules = new Map<
	number,
	Readonly<{ callback: () => void; delayMs: number }>
>();
let activityScheduleId = 0;
const activityController = new ReaderNotificationController({
	requests,
	native,
	actions,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	activity: {
		visible: () => activityVisible,
		subscribe(listener) {
			activityListeners.add(listener);
			return () => activityListeners.delete(listener);
		},
	},
	openRevalidateMs: 0,
	nativePollIntervalMs: 0,
	syntheticPollIntervalMs: 0,
	schedule(callback, delayMs) {
		const id = ++activityScheduleId;
		activitySchedules.set(id, Object.freeze({ callback, delayMs }));
		return id;
	},
	cancel(handle) {
		activitySchedules.delete(Number(handle));
	},
});
await activityController.open();
assert(
	activitySchedules.size === 0,
	'显式关闭通知轮询后，逐条活动“全部”打开不得创建周期任务',
);
await activityController.selectGroup('replies');
assert(
	activitySchedules.size === 0,
	'切换已有缓存的合成分类不得创建可见期轮询',
);
activityVisible = false;
for (const listener of [...activityListeners]) listener();
assert(
	Number(activitySchedules.size) === 0 &&
		activityController.snapshot.history.status === 'idle',
	'后台 owner 尚未启动时，页面隐藏不得伪造 paused 历史状态或遗留调度',
);
const repliesRequestsBeforeRecovery = gateway.requests.filter((request) =>
	request.group === 'replies').length;
activityVisible = true;
for (const listener of [...activityListeners]) listener();
await flushMicrotasks();
assert(
	gateway.requests.filter((request) => request.group === 'replies').length ===
		repliesRequestsBeforeRecovery + 1 &&
	Number(activitySchedules.size) === 0,
	'页面恢复、重新联网等 activity 信号只能做一次到期漏事件校验，不能续约周期轮询',
);
activityController.close();
assert(Number(activitySchedules.size) === 0, '关闭消息面板不得创建恢复轮询');
activityController.destroy();
assert(Number(activityListeners.size) === 0, '通知 activity 监听必须随 owner 精确释放');

const fallbackPollSchedules = new Map<
	number,
	Readonly<{ callback: () => void; delayMs: number }>
>();
let fallbackPollScheduleId = 0;
let fallbackPollLoads = 0;
const fallbackPollController = new ReaderNotificationController({
	requests: {
		async load(group: ReaderNotificationGroupKey, page: number) {
			fallbackPollLoads += 1;
			return Object.freeze({
				group,
				page,
				records: Object.freeze([]),
				total: 0,
				hasNext: false,
				nextCursor: null,
			});
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	native,
	actions,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	activity: {
		visible: () => true,
		subscribe: () => () => {},
	},
	nativePollIntervalMs: 10_000,
	syntheticPollIntervalMs: 10_000,
	openRevalidateMs: 60_000,
	now: () => 0,
	schedule(callback, delayMs) {
		const id = ++fallbackPollScheduleId;
		fallbackPollSchedules.set(id, Object.freeze({ callback, delayMs }));
		return id;
	},
	cancel(handle) {
		fallbackPollSchedules.delete(Number(handle));
	},
});
await fallbackPollController.open();
assert(
	fallbackPollSchedules.size === 1 &&
		[...fallbackPollSchedules.values()][0]?.delayMs === 10_000,
	'通知面板可见时必须安排唯一低频兜底轮询，以覆盖宿主漏发事件',
);
const fallbackLoadsBeforePoll = fallbackPollLoads;
const fallbackPollEntry = fallbackPollSchedules.entries().next().value as
	| [number, Readonly<{ callback: () => void; delayMs: number }>]
	| undefined;
if (!fallbackPollEntry) throw new Error('通知兜底轮询尚未排入');
fallbackPollSchedules.delete(fallbackPollEntry[0]);
fallbackPollEntry[1].callback();
await flushMicrotasks();
assert(
	fallbackPollLoads > fallbackLoadsBeforePoll &&
		fallbackPollSchedules.size === 1,
	'通知兜底轮询到期后必须执行增量更新，并续排下一次唯一轮询',
);
fallbackPollController.close();
assert(fallbackPollSchedules.size === 0, '关闭通知面板必须撤销兜底轮询');
fallbackPollController.destroy();

const clickNative = new FakeNotificationNative();
clickNative.unread = 1;
consolidatedReplyCount = 1;
const clickSchedules = new Map<number, () => void>();
let clickScheduleId = 0;
const clickController = new ReaderNotificationController({
	requests,
	native: clickNative,
	actions,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	schedule(callback) {
		const id = ++clickScheduleId;
		clickSchedules.set(id, callback);
		return id;
	},
	cancel(handle) {
		clickSchedules.delete(Number(handle));
	},
});
await clickController.open();
clickNative.emitClicked(Object.freeze({
	notificationId: 501,
	href: '/t/test/42/3',
	wasRead: false,
}));
await flushMicrotasks();
assert(
	clickController.snapshot.records
		.filter((record) => record.sourceNotificationId === 501)
		.every((record) => record.read === true) &&
		clickController.snapshot.unreadCount === 0 &&
		clickSchedules.size === 1,
	'宿主点击必须按 notification ID 原子同步记录、计数并调度一次回查',
);
const [clickRefreshId, clickRefresh] = [...clickSchedules][0]!;
clickSchedules.delete(clickRefreshId);
clickRefresh();
await flushMicrotasks();
assert(
	clickController.snapshot.records
		.filter((record) => record.sourceNotificationId === 501)
		.every((record) => record.read === true),
	'宿主已读 mutation 传播期间即使权威回查暂返旧值，精确记录也不得反弹为未读',
);
clickController.destroy();
consolidatedReplyCount = 2;

const consolidatedLike = normalizeNativeNotification({
	id: 701,
	notification_type: 5,
	read: false,
	created_at: '2026-07-30T02:00:00.000Z',
}, {
	actor: 'alice',
	typeName: 'liked_consolidated',
	typeLabel: '赞',
	summary: '多人赞了你的帖子',
	topicId: 42,
	postNumber: 3,
}, 'all');
const likeActions = Object.freeze([
	normalizeUserActionNotification({
		action_type: 2,
		post_id: 300,
		acting_user_id: 9,
		acting_username: 'alice',
		created_at: '2026-07-30T02:00:00.000Z',
		topic_id: 42,
		post_number: 3,
		title: '测试主题',
	}, 'likes'),
	normalizeUserActionNotification({
		action_type: 2,
		post_id: 300,
		acting_user_id: 10,
		acting_username: 'bob',
		created_at: '2026-07-30T01:59:00.000Z',
		topic_id: 42,
		post_number: 3,
		title: '测试主题',
	}, 'likes'),
]);
const associationController = new ReaderNotificationController({
	requests: {
		authScope: requests.authScope,
		async load(group: ReaderNotificationGroupKey, page: number) {
			const records = group === 'all'
				? Object.freeze([consolidatedLike])
				: group === 'likes' ? likeActions : Object.freeze([]);
			return {
				group,
				page,
				records,
				total: records.length,
				hasNext: false,
				nextCursor: null,
			};
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	native,
	actions,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
});
await associationController.open();
await associationController.selectGroup('likes');
const linkedLikes = new Map(associationController.snapshot.records.map((record) => [
	record.actor,
	record.sourceNotificationId,
]));
assert(
	linkedLikes.get('alice') === 701 && linkedLikes.get('bob') === null,
	'聚合通知只能继承 actor 精确匹配的原生 ID，不能把单候选强套给其他子记录',
);
associationController.destroy();

const invalidations: string[][] = [];
const targets: Array<Readonly<Record<string, unknown>>> = [];
let targetOpened = true;
const scheduled = new Map<number, () => void>();
const scheduledDelays = new Map<number, number>();
let scheduleId = 0;
// 上述 adapter 级断言已经填充 FakeGateway 的持久缓存；主 controller 场景
// 单独验证冷加载、分页与实时刷新，避免跨场景缓存改变既有初始条件。
gateway.notificationCache.clear();
gateway.collectionCache.clear();
gateway.topicCache.clear();
const controller = new ReaderNotificationController({
	requests,
	native,
	actions,
	cache: {
		async invalidate(query): Promise<void> {
			invalidations.push([...query.tags]);
		},
	},
	target: {
		async openTarget(input): Promise<boolean> {
			targets.push(input);
			return targetOpened;
		},
	},
	schedule(callback, delayMs) {
		const id = ++scheduleId;
		scheduled.set(id, callback);
		scheduledDelays.set(id, delayMs);
		return id;
	},
	cancel(handle) {
		scheduled.delete(Number(handle));
		scheduledDelays.delete(Number(handle));
	},
	searchForms(value) {
		return value.includes('回复正文')
			? Object.freeze([value, 'huifuzhengwen', 'hfzw'])
			: Object.freeze([value]);
	},
});
await controller.open();
const aggregateReply = controller.snapshot.records.find((record) =>
	record.group === 'replies');
assert(
	controller.snapshot.open &&
	aggregateReply?.source === 'user-actions' &&
	aggregateReply.aggregateCount === null &&
	aggregateReply.sourceNotificationId === 501 &&
	controller.snapshot.records.every((record) =>
		record.source !== 'notifications') &&
	controller.snapshot.unreadCount === 2,
	'“全部”必须展示分类逐条活动，同时在后台继承原生通知 ID 与 current-user 计数',
);
await controller.nextPage();
await controller.previousPage();
const pageOneLoadsBeforeChange = ajax.paths.filter((path) =>
	path.startsWith('/notifications.json?offset=24&')).length;
native.emitChanged();
await flushMicrotasks();
for (const callback of [...scheduled.values()]) callback();
scheduled.clear();
await flushMicrotasks();
await controller.nextPage();
assert(
	ajax.paths.filter((path) =>
		path.startsWith('/notifications.json?offset=24&')).length ===
		pageOneLoadsBeforeChange,
	'notifications:changed 只能刷新头部增量，不得重新请求已缓存的原生深层历史：' +
		JSON.stringify({
			before: pageOneLoadsBeforeChange,
			after: ajax.paths.filter((path) =>
				path.startsWith('/notifications.json?offset=24&')).length,
			paths: ajax.paths.filter((path) => path.startsWith('/notifications.json')),
		}),
);
await controller.previousPage();
await controller.selectGroup('replies');
const inheritedReply = controller.snapshot.records[0];
assert(
	inheritedReply?.source === 'user-actions' &&
	inheritedReply.sourceNotificationId === 501 &&
	inheritedReply.read === false,
	'合成回复必须按 actor/topic/post 继承原生通知 ID 与已读状态',
);
await controller.selectGroup('reactionLikes');
assert(
	controller.snapshot.group === 'reactionLikes' &&
	new Set(controller.snapshot.records.map((record) => record.group)).size === 2 &&
	controller.snapshot.records.some((record) => record.group === 'likes') &&
	controller.snapshot.records.some((record) => record.group === 'reactions') &&
	controller.snapshot.groupCounts.get('reactionLikes') ===
		(controller.snapshot.groupCounts.get('likes') ?? 0) +
		(controller.snapshot.groupCounts.get('reactions') ?? 0) &&
	(controller.snapshot.groupCounts.get('all') ?? 0) >=
		(controller.snapshot.groupCounts.get('reactionLikes') ?? 0),
	'回应与赞 Tab 必须合并两条底层历史索引及其计数，不能丢失任一来源',
);
	await controller.selectGroup('replies');
	const replyLoadsBeforeTaxonomyFilter = gateway.requests.filter((request) =>
		request.group === 'replies').length;
	const repliesTabCount = controller.snapshot.groupCounts.get('replies');
	assert(
		new Set(controller.snapshot.categoryOptions.map((option) => option.label))
			.size === 2 &&
		controller.snapshot.categoryOptions.some((option) =>
			option.label === '开发') &&
		controller.snapshot.categoryOptions.some((option) =>
			option.label === '反馈') &&
			controller.snapshot.tagOptions.map((option) => option.label).join(',') ===
				'alpha',
		'消息类别与标签选项必须从当前分类的本地历史记录生成',
	);
	controller.setCategoryFilter('category:10');
	controller.setTagFilter('tag:alpha');
	assert(
		controller.snapshot.categoryFilter === 'category:10' &&
		controller.snapshot.tagFilter === 'tag:alpha' &&
		controller.snapshot.records.length === 1 &&
		controller.snapshot.records[0]?.actor === 'bob' &&
		controller.snapshot.groupCounts.get('replies') === repliesTabCount &&
		gateway.requests.filter((request) => request.group === 'replies').length ===
			replyLoadsBeforeTaxonomyFilter,
		'消息类别与标签筛选必须只重投影本地缓存，不得改写 tab 总数或触发额外请求',
	);
	controller.setCategoryFilter('');
	controller.setTagFilter('');
	const [notificationDay, notificationDayCount] =
		[...controller.snapshot.dayCounts][0] ?? ['', 0];
	controller.setDateFilter(notificationDay);
	assert(
		Boolean(notificationDay) &&
			controller.snapshot.dateFilter === notificationDay &&
			controller.snapshot.total === notificationDayCount,
		'消息活动日历必须按本地日期重投影缓存记录与计数',
	);
	controller.resetFilters();
	controller.setQuery('回复正文');
assert(
	controller.snapshot.query === '回复正文' &&
	controller.snapshot.records.length === 1,
	'消息搜索必须只在已加载有界页缓存内工作',
);
controller.setQuery('hfzw');
assert(
	controller.snapshot.records.length === 1,
	'消息搜索必须复用 userscript 注入的拼音全拼/首字母 forms',
);
native.emitChanged();
await flushMicrotasks();
for (const callback of [...scheduled.values()]) callback();
scheduled.clear();
await flushMicrotasks();
assert(
	controller.snapshot.records.length === 1,
	'搜索期间的原生变更必须保留当前有界搜索快照，不能先清空结果',
);
	await controller.selectGroup('replies');
	assert(
	controller.snapshot.records[0]?.sourceNotificationId === 501,
	'搜索期间切换分类也必须先恢复 canonical 通知页，不能让合成记录丢失真实 ID',
);
controller.setQuery('hfzw');
const repliesLoadsBeforeChange = gateway.requests.filter((request) =>
	request.group === 'replies').length;
native.emitChanged();
await flushMicrotasks();
for (const callback of [...scheduled.values()]) callback();
scheduled.clear();
await flushMicrotasks();
controller.setQuery('');
await flushMicrotasks();
assert(
	gateway.requests.filter((request) =>
		request.group === 'replies').length === repliesLoadsBeforeChange + 1 &&
	Number(controller.snapshot.records.length) === 2,
	'清空搜索必须消费延迟失效并重新读取当前分类，不能留下空面板',
);
controller.setQuery('不存在');
assert(
	Number(controller.snapshot.records.length) === 0,
	'本地搜索不得偷偷发起第二套请求',
);
controller.setQuery('');
targetOpened = false;
await controller.openRecord(inheritedReply);
assert(
	controller.snapshot.open &&
		Number(native.readCommits) === 0 &&
		Number(controller.snapshot.unreadCount) === 2,
	'目标 Topic 或楼层未真正打开时必须保留消息面板和未读状态，不能把分派当成功',
);
targetOpened = true;
const mutationsBeforeFirstChildRead = mutationDescriptors.length;
await controller.markRecordRead(inheritedReply);
assert(
	mutationDescriptors.length === mutationsBeforeFirstChildRead &&
	Number(native.readCommits) === 0 &&
	controller.snapshot.records[0]?.read === true &&
	Number(controller.snapshot.unreadCount) === 2,
	'合并通知的首个子记录只能更新子级状态，不能提前提交父通知',
);
await controller.selectGroup('all');
await controller.markRecordRead(
	controller.snapshot.records.find((record) => record.target?.postNumber === 2)!,
);
const committedReplies = controller.snapshot.records.filter((record) =>
	record.sourceNotificationId === 501);
assert(
	mutationDescriptors.at(-1)?.operation === 'notification-mark-read' &&
	Number(native.readCommits) === 1 &&
	committedReplies.length === 2 &&
	committedReplies.every((record) => record.read === true) &&
	Number(controller.snapshot.unreadCount) === 1,
	'最后一个未读子记录完成后才可提交父通知并同步 current-user',
);
await controller.selectGroup('replies');
await controller.openRecord(controller.snapshot.records[0]!);
assert(
	targets.at(-1)?.topicId === 42 &&
	targets.at(-1)?.postNumber === 3 &&
	targets.at(-1)?.source === 'notification' &&
	controller.snapshot.open,
	'点击消息必须走统一 openTarget，并保留已打开的通知工具标签',
);

await controller.open();
consolidatedReplyCount = 4;
native.unread = 3;
const invalidationsBeforeBurst = invalidations.length;
const aggregateLoadsBeforeBurst = new Map(
	READER_NOTIFICATION_AGGREGATE_GROUP_ORDER.map((group) => [
		group,
		gateway.requests.filter((request) => request.group === group).length,
	]),
);
native.emitChanged();
native.emitChanged();
await flushMicrotasks();
assert(
		invalidations.length === invalidationsBeforeBurst + 1 &&
		invalidations.at(-1)?.includes('notifications') &&
		scheduled.size === 1 &&
		scheduledDelays.get([...scheduled.keys()][0]!) === 0 &&
		Number(controller.snapshot.unreadCount) === 3,
	'MessageBus/app-event 事件爆发必须只做一次中央失效，并把当前可见分类调度到零延迟刷新',
);
for (const callback of [...scheduled.values()]) callback();
scheduled.clear();
await flushMicrotasks();
const aggregateLoadsAfterBurst = new Map(
	READER_NOTIFICATION_AGGREGATE_GROUP_ORDER.map((group) => [
		group,
		gateway.requests.filter((request) => request.group === group).length,
	]),
);
assert(
	(aggregateLoadsAfterBurst.get('replies') ?? 0) >
		(aggregateLoadsBeforeBurst.get('replies') ?? 0) &&
	READER_NOTIFICATION_AGGREGATE_GROUP_ORDER
		.filter((group) => group !== 'replies')
		.every((group) =>
			(aggregateLoadsAfterBurst.get(group) ?? 0) ===
				(aggregateLoadsBeforeBurst.get(group) ?? 0)) &&
	String(controller.snapshot.group) === 'replies',
	'Discourse 消息事件必须就近刷新当前分类与原生关联，不能先扇出全部分类请求',
);
scheduled.clear();
scheduledDelays.clear();
const replyLoadsBeforeExplicitRefresh = gateway.requests.filter((request) =>
	request.group === 'replies').length;
native.emitChanged();
await flushMicrotasks();
assert(
	[...scheduledDelays.values()].includes(0),
	'宿主事件必须先排入零延迟头页校验',
);
await controller.refresh();
assert(
	gateway.requests.filter((request) => request.group === 'replies').length ===
		replyLoadsBeforeExplicitRefresh + 1 &&
		![...scheduledDelays.values()].includes(0),
	'主动打开或刷新必须吞掉尚未执行的同类宿主事件，不得串行重复两轮',
);
scheduled.clear();
scheduledDelays.clear();
await flushMicrotasks();
const requestsAfterEventRefresh = gateway.requests.length;
// MessageBus 失效已经刷新并提交 controller 头页；FakeGateway 不模拟真实
// ResponseRepository 的同标签失效，切 tab 时不得再次回放测试双缓存的旧快照。
gateway.notificationCache.clear();
gateway.collectionCache.clear();
gateway.topicCache.clear();
await controller.selectGroup('all');
const refreshedReplies = new Map(controller.snapshot.records
	.filter((record) => record.group === 'replies')
	.map((record) => [
		record.target?.postNumber ?? 0,
		record.read,
	]));
assert(
	gateway.requests.length === requestsAfterEventRefresh &&
	refreshedReplies.size === 4 &&
	refreshedReplies.get(2) === true &&
	refreshedReplies.get(3) === true &&
	refreshedReplies.get(4) === false &&
	refreshedReplies.get(5) === false,
	'事件刷新后的“全部”必须直接显示最新页首，旧拆分条目保持已读且新条目保持未读',
);
const mutationsBeforePartialRead = mutationDescriptors.length;
await controller.markRecordRead(
	controller.snapshot.records.find((record) => record.target?.postNumber === 4)!,
);
const partiallyReadReplies = new Map(controller.snapshot.records
	.filter((record) => record.group === 'replies')
	.map((record) => [
		record.target?.postNumber ?? 0,
		record.read,
	]));
assert(
	mutationDescriptors.length === mutationsBeforePartialRead &&
	partiallyReadReplies.get(4) === true &&
	partiallyReadReplies.get(5) === false,
	'同一父通知的多个未读子记录必须逐条已读，最后一条之前不得提前提交父通知',
);

const catchUpKnown = normalizeUserActionNotification({
	action_type: 6,
	post_id: 9_100,
	acting_user_id: 91,
	acting_username: 'known-user',
	created_at: '2026-08-16T00:00:00.000Z',
	topic_id: 910,
	post_number: 2,
	title: '已知通知',
}, 'replies');
const catchUpNew = [9_101, 9_102].map((postId, index) =>
	normalizeUserActionNotification({
		action_type: 6,
		post_id: postId,
		acting_user_id: 92 + index,
		acting_username: `new-user-${index}`,
		created_at: `2026-08-17T00:0${index}:00.000Z`,
		topic_id: 911 + index,
		post_number: 2,
		title: `新增通知 ${index + 1}`,
	}, 'replies'));
let catchUpRefresh = false;
const catchUpLoads: Array<Readonly<{
	group: ReaderNotificationGroupKey;
	page: number;
}>> = [];
const catchUpController = new ReaderNotificationController({
	requests: {
		authScope: requests.authScope,
		async load(group: ReaderNotificationGroupKey, page: number) {
			catchUpLoads.push(Object.freeze({ group, page }));
			if (group !== 'replies') return Object.freeze({
				group,
				page,
				records: Object.freeze([]),
				total: 0,
				hasNext: false,
				nextCursor: null,
			});
			if (!catchUpRefresh) return Object.freeze({
				group,
				page,
				records: Object.freeze([catchUpKnown]),
				total: 1,
				hasNext: false,
				nextCursor: null,
			});
			if (page === 0) return Object.freeze({
				group,
				page,
				records: Object.freeze(catchUpNew),
				total: 3,
				hasNext: true,
				nextCursor: 100,
			});
			if (page === 1) return Object.freeze({
				group,
				page,
				records: Object.freeze([catchUpKnown]),
				total: 3,
				hasNext: true,
				nextCursor: 200,
			});
			throw new Error('命中已知通知后不得继续请求第三页');
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	native,
	actions,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
});
await catchUpController.open();
await catchUpController.selectGroup('replies');
catchUpRefresh = true;
catchUpLoads.length = 0;
await catchUpController.refresh();
assert(
	catchUpLoads.filter((entry) => entry.group === 'replies')
		.map((entry) => entry.page).join(',') === '0,1' &&
	catchUpController.snapshot.groupCounts.get('replies') === 3,
	'通知事件刷新必须从首页追到首个已知 identity 所在页，合并新记录后立即停止',
);
catchUpLoads.length = 0;
catchUpController.close();
await catchUpController.open();
assert(
	catchUpLoads.filter((entry) => entry.group === 'replies')
		.map((entry) => entry.page).join(',') === '0',
	'通知浮窗每次打开都必须立即刷新头页，并在首页命中已知 identity 后结束',
);
catchUpController.destroy();

const backgroundExpansionParent = normalizeNativeNotification({
	id: 9_200,
	notification_type: 1,
	read: false,
	created_at: '2026-08-17T01:00:00.000Z',
	topic_id: 920,
	post_number: 3,
	data: {
		display_username: 'reply-user',
		topic_title: '合并回复主题',
		consolidated_count: 2,
		reply_to_post_number: 1,
	},
}, {
	actor: 'reply-user',
	typeName: 'replied',
	typeLabel: '回复',
	topicId: 920,
	postNumber: 3,
}, 'all');
let backgroundExpansionStarted = false;
let releaseBackgroundExpansion!: () => void;
const backgroundExpansionBarrier = new Promise<void>((resolve) => {
	releaseBackgroundExpansion = resolve;
});
const quickRefreshController = new ReaderNotificationController({
	requests: {
		authScope: requests.authScope,
		async load(
			group: ReaderNotificationGroupKey,
			page: number,
			options?: Parameters<DiscourseNotificationRequestAdapter['load']>[2],
		) {
			if (group === 'all') {
				if (options?.expandConsolidated === true) {
					backgroundExpansionStarted = true;
					await backgroundExpansionBarrier;
				}
				return Object.freeze({
					group,
					page,
					records: Object.freeze([backgroundExpansionParent]),
					total: 1,
					hasNext: false,
					nextCursor: null,
				});
			}
			return Object.freeze({
				group,
				page,
				records: Object.freeze([]),
				total: 0,
				hasNext: false,
				nextCursor: null,
			});
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	native,
	actions,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	backgroundWarmDelayMs: 60_000,
	schedule: () => 1,
	cancel: () => {},
});
await quickRefreshController.open();
let quickRefreshCompleted = false;
const quickRefresh = quickRefreshController.refresh().then(() => {
	quickRefreshCompleted = true;
});
await flushMicrotasks();
assert(
	backgroundExpansionStarted && quickRefreshCompleted,
	'主动更新命中倒序 identity 边界后必须立即完成，合并回复 Topic 展开只能后台补齐',
);
releaseBackgroundExpansion();
await quickRefresh;
await flushMicrotasks();
quickRefreshController.destroy();

const cachedSlowReaction = Object.freeze({
	...catchUpKnown,
	identity: 'reaction:cached',
	group: 'reactions' as const,
	source: 'reactions-received' as const,
	typeName: 'reaction',
	typeLabel: '回应',
	summary: '@cached-user · 回应了你的帖子 · 已缓存回应',
});
const freshSlowReaction = Object.freeze({
	...cachedSlowReaction,
	identity: 'reaction:fresh',
	actor: 'fresh-user',
	createdAt: '2026-08-17T02:00:00.000Z',
	summary: '@fresh-user · 回应了你的帖子 · 新回应',
});
let releaseSlowReaction!: () => void;
let slowReactionBarrier = new Promise<void>((resolve) => {
	releaseSlowReaction = resolve;
});
let slowReactionLoads = 0;
let slowReactionFailure = false;
const slowReactionController = new ReaderNotificationController({
	requests: {
		authScope: requests.authScope,
		async load(group: ReaderNotificationGroupKey, page: number) {
			if (group !== 'reactions') return Object.freeze({
				group,
				page,
				records: Object.freeze([]),
				total: 0,
				hasNext: false,
				nextCursor: null,
			});
			slowReactionLoads += 1;
			if (slowReactionFailure) throw new Error('回应接口超时');
			await slowReactionBarrier;
			return Object.freeze({
				group,
				page,
				records: Object.freeze([freshSlowReaction, cachedSlowReaction]),
				total: 2,
				hasNext: false,
				nextCursor: null,
			});
		},
	} as unknown as DiscourseNotificationRequestAdapter,
	native,
	actions,
	cache: { async invalidate(): Promise<void> {} },
	target: { async openTarget(): Promise<boolean> { return true; } },
	backgroundWarmDelayMs: 60_000,
	schedule: () => 1,
	cancel: () => {},
});
slowReactionController.applySyncedHistoryRecords([cachedSlowReaction]);
await slowReactionController.open();
assert(
	!slowReactionController.snapshot.refreshing &&
	slowReactionController.snapshot.backgroundRefreshingGroups.includes(
		'reactions',
	) && slowReactionLoads === 1,
	'已有回应缓存时，主刷新必须先完成并把慢回应接口留在可观察的后台任务中',
);
await slowReactionController.refresh();
assert(
	slowReactionLoads === 1,
	'回应后台更新未结束时，重复打开或主动刷新不得发出第二个相同请求',
);
releaseSlowReaction();
await flushMicrotasks();
assert(
	!slowReactionController.snapshot.backgroundRefreshingGroups.length &&
	slowReactionController.snapshot.groupCounts.get('reactions') === 2,
	'回应后台更新完成后必须自动合并新记录并更新分类计数',
);
slowReactionFailure = true;
await slowReactionController.refresh();
await flushMicrotasks();
assert(
	slowReactionController.snapshot.backgroundRefreshFailedGroups.includes(
		'reactions',
	) && !slowReactionController.snapshot.error,
	'回应后台更新失败必须独立暴露状态，不能把已完成的主要通知刷新改成失败',
);
slowReactionFailure = false;
slowReactionBarrier = new Promise<void>((resolve) => {
	releaseSlowReaction = resolve;
});
await slowReactionController.refresh();
assert(
	slowReactionController.snapshot.backgroundRefreshingGroups.includes(
		'reactions',
	),
	'回应后台失败后再次主动刷新必须允许重试',
);
slowReactionController.clearCache();
releaseSlowReaction();
await flushMicrotasks();
assert(
	slowReactionController.cacheStats().records === 0 &&
	!slowReactionController.snapshot.backgroundRefreshingGroups.length,
	'清空缓存后，旧回应后台请求的迟到结果不得重新写回缓存',
);
slowReactionController.destroy();

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body></body></html>',
);
const document = parsedDocument as unknown as Document;

const paginationList = document.createElement('div');
const paginationPager = document.createElement('div');
document.body.append(paginationList, paginationPager);
Object.defineProperties(paginationList, {
	scrollTop: { configurable: true, writable: true, value: 600 },
	clientHeight: { configurable: true, value: 400 },
	scrollHeight: { configurable: true, value: 1_000 },
});
let paginationLoads = 0;
let finishFirstPagination!: () => void;
const paginationWindow = new ReaderCollectionScrollWindow({
	list: paginationList,
	pager: paginationPager,
	identity: (record: Readonly<{ identity: string }>) => record.identity,
	loadMore: () => {
		paginationLoads += 1;
		if (paginationLoads === 1) {
			return new Promise<void>((resolve) => {
				finishFirstPagination = resolve;
			});
		}
	},
});
paginationWindow.sync({ loading: true, hasMore: false });
paginationList.dispatchEvent(new (
	parsedDocument.defaultView as unknown as { Event: typeof Event }
).Event('scroll'));
await flushMicrotasks();
assert(
	paginationLoads === 0,
	'分页仍加载或下一页状态未就绪时，触底不得发出重复请求',
);
paginationWindow.sync({ loading: false, hasMore: true });
await flushMicrotasks();
assert(
	paginationLoads === 1,
	'触底先于分页状态就绪时，状态解锁必须主动加载下一页，不能依赖切换浮窗标签',
);
paginationList.dispatchEvent(new (
	parsedDocument.defaultView as unknown as { Event: typeof Event }
).Event('scroll'));
await flushMicrotasks();
assert(
	paginationLoads === 1,
	'上一页请求尚未结束时，连续触底不得并发加载下一页',
);
finishFirstPagination();
await flushMicrotasks();
assert(
	paginationLoads === 2,
	'上一页结束时若视口仍在底部，必须补做一次边界检查而不是等待切换标签',
);
paginationWindow.scope.destroy();
paginationList.remove();
paginationPager.remove();

let finishProgressRetry!: () => void;
let progressRetryCalls = 0;
const progressRetry = new ReaderCollectionProgressView({
	document,
	retry: () => new Promise<void>((resolve) => {
		progressRetryCalls += 1;
		finishProgressRetry = resolve;
	}),
});
progressRetry.render({
	visible: true,
	label: '当前页缓存更新失败',
	detail: '正在显示上次已加载内容',
	state: 'error',
	completed: 0,
	total: 1,
	valueText: '缓存更新失败',
	retryable: true,
});
const progressRetryButton = progressRetry.element.querySelector<HTMLButtonElement>(
	'.ldp-user-observation-progress-retry',
)!;
progressRetryButton.click();
await flushMicrotasks();
assert(
	progressRetryCalls === 1 &&
	progressRetryButton.disabled &&
	progressRetryButton.dataset.ldpRequestBusy === '1' &&
	progressRetryButton.textContent === '重试中',
	'集合缓存失败入口必须可点击，并立即投影单飞 busy 状态',
);
finishProgressRetry();
await flushMicrotasks();
assert(
	!progressRetryButton.disabled &&
	progressRetryButton.dataset.ldpRequestBusy === '0' &&
	progressRetryButton.textContent === '重试',
	'集合缓存重试完成后必须恢复可操作状态',
);
progressRetry.render({
	visible: true,
	label: '消息历史自动续传',
	detail: '断点已保存，将按中央请求许可自动恢复',
	state: 'waiting',
	completed: 4,
	total: 7,
	valueText: '4/7 来源，已缓存 28 页，总页数探测中，等待自动续传',
	retryable: false,
});
assert(
	progressRetry.element.querySelector(
		'.ldp-user-observation-progress-retry',
	) === null &&
	progressRetry.element.dataset.phase === 'waiting',
	'已有自动续传计划时进度区不得再要求用户手工点击重试',
);
progressRetry.destroy();
const partialProgress = new ReaderCollectionProgressView({
	document,
	retry: () => {},
});
partialProgress.render({
	visible: true,
	label: '回应',
	detail: '4 / 7 来源 · 已缓存 28 页 · 总页数探测中',
	state: 'running',
	completed: 4,
	total: 7,
	valueText: '4/7 来源，已缓存 28 页，总页数探测中',
});
const partialProgressBar = partialProgress.element.querySelector<HTMLElement>(
	'[role="progressbar"]',
)!;
const partialProgressSegment = partialProgressBar.children[4] as HTMLElement;
assert(
	partialProgressBar.getAttribute('aria-valuenow') === '4' &&
		partialProgressBar.getAttribute('aria-valuetext') ===
			'4/7 来源，已缓存 28 页，总页数探测中' &&
		partialProgressSegment.classList.contains('is-active') &&
		!partialProgressSegment.classList.contains('is-partial') &&
		partialProgressSegment.style.getPropertyValue(
			'--ldp-collection-progress',
		) === '',
	'通知缓存进度必须只用固定七来源表达到底状态；页数只显示已缓存值，不能用移动估算分母制造小数进度',
);
partialProgress.destroy();
const template = createReaderShellTemplate({
	document,
	mount: document.body,
	listModeAllowed: true,
	siteName: 'LINUX DO',
	homeUrl: 'https://linux.do/',
});
Object.defineProperties(document.defaultView, {
	innerWidth: { configurable: true, value: 1_000 },
	innerHeight: { configurable: true, value: 800 },
});
let notificationToggleTop = 40;
template.notificationsToggle.getBoundingClientRect = () => ({
	top: notificationToggleTop,
	right: 840,
	bottom: notificationToggleTop + 30,
	left: 800,
	width: 40,
	height: 30,
	x: 800,
	y: notificationToggleTop,
	toJSON() {},
});
template.notificationsPopover.getBoundingClientRect = () => ({
	top: 0,
	right: 420,
	bottom: 560,
	left: 0,
	width: 420,
	height: 560,
	x: 0,
	y: 0,
	toJSON() {},
});
const viewNotifications: string[] = [];
const view = new ReaderNotificationPanelView({
	document,
	mount: template.view.surfaceHost,
	controller,
	elements: {
		root: template.view.root,
		toggle: template.notificationsToggle,
		badge: template.notificationUnreadBadge,
		popover: template.notificationsPopover,
		modeTabs: template.notificationModeTabs,
		groupPanels: template.notificationGroupPanels,
		groupTabs: template.notificationGroupTabs,
		toolbar: template.notificationToolbar,
		unreadStatus: template.notificationUnreadStatus,
		markAll: template.notificationMarkAll,
		newMessage: template.notificationNewMessage,
			search: template.notificationSearch,
			searchClear: template.notificationSearchClear,
			categoryFilter: template.notificationCategoryFilter,
			tagFilter: template.notificationTagFilter,
		list: template.notificationList,
		pagePrevious: template.notificationPagePrevious,
		pageInfo: template.notificationPageInfo,
		pageNext: template.notificationPageNext,
	},
	baseUrl: 'https://linux.do/',
	relativeTime: () => '刚刚',
	emojiSource: (id) => `/emoji/${id}.png`,
	archiveMarker: () => Object.freeze({
		status: 404,
		postNumber: null,
		topicTitle: '测试主题',
	}),
	schedule: () => 1,
	cancel: () => {},
	notify: (message) => viewNotifications.push(message),
});
assert(
	template.notificationUnreadBadge.textContent === '3' &&
	!template.notificationUnreadBadge.hidden &&
	template.notificationsToggle.getAttribute('aria-label') ===
		'消息，3 条未读',
	'顶部消息按钮必须用未读数量徽标代替无文字红点，并同步无障碍名称',
);
assert(
	template.notificationsPopover.parentElement?.classList.contains(
		'ldp-reader-floating-window-body',
	) === true &&
	document.querySelector<HTMLElement>(
		'.ldp-reader-floating-window.is-notifications',
	)?.hidden === false &&
	template.notificationPageInfo.parentElement?.hidden === true &&
	template.notificationMarkAll.closest(
		'.ldp-reader-floating-window-actions',
	) !== null,
	'消息入口必须迁入用户观察同款独立浮窗，而不是继续锚定标题栏',
);
const notificationRefresh = document.querySelector<HTMLButtonElement>(
	'.ldp-reader-floating-window.is-notifications .ldp-notification-refresh',
);
assert(
	notificationRefresh?.getAttribute('aria-label') === '更新通知' &&
		notificationRefresh.closest('.ldp-reader-floating-window-actions') !== null &&
		notificationRefresh.querySelector('[data-icon="rotate-ccw"]') !== null,
	'通知浮窗标题栏必须提供可访问的主动更新图标',
);
const notificationRequestsBeforeManualRefresh = gateway.requests.length;
let releaseManualNotificationRefresh!: () => void;
gateway.notificationBarrier = new Promise<void>((resolve) => {
	releaseManualNotificationRefresh = resolve;
});
notificationRefresh.click();
await flushMicrotasks();
assert(
	gateway.requests.length > notificationRequestsBeforeManualRefresh &&
		notificationRefresh.disabled &&
		notificationRefresh.dataset.ldpRequestBusy === '1' &&
		notificationRefresh.dataset.refreshState === 'running' &&
		notificationRefresh.classList.contains('is-refreshing') &&
		notificationRefresh.querySelector('[data-icon="loader"]') !== null &&
		document.querySelector<HTMLElement>(
			'.ldp-reader-floating-window.is-notifications ' +
			'.ldp-reader-floating-window-meta',
		)?.textContent?.includes('正在更新通知') === true,
	'主动更新期间必须显示真实旋转忙态和完整的“正在更新通知”状态',
);
gateway.notificationBarrier = null;
releaseManualNotificationRefresh();
await flushMicrotasks();
assert(
	!notificationRefresh.disabled &&
		notificationRefresh.dataset.ldpRequestBusy === '0' &&
		notificationRefresh.dataset.refreshState === 'success' &&
		!notificationRefresh.classList.contains('is-refreshing') &&
		notificationRefresh.querySelector('[data-icon="check-square"]') !== null &&
		viewNotifications.at(-1) === '通知已更新',
	'主动更新完成后必须显示成功状态并恢复可操作，不能停在忙态',
);
let releaseBackgroundReaction!: () => void;
gateway.reactionBarrier = new Promise<void>((resolve) => {
	releaseBackgroundReaction = resolve;
});
const reactionRequestsBeforeBackgroundRefresh = gateway.requests.filter(
	(request) => request.group === 'reactions',
).length;
notificationRefresh.click();
await flushMicrotasks();
const backgroundReactionMeta = document.querySelector<HTMLElement>(
	'.ldp-reader-floating-window.is-notifications ' +
	'.ldp-reader-floating-window-meta',
);
assert(
	!notificationRefresh.disabled &&
	notificationRefresh.dataset.ldpRequestBusy === '0' &&
	!notificationRefresh.classList.contains('is-refreshing') &&
	notificationRefresh.getAttribute('aria-label') ===
		'主要通知已更新，回应后台更新中' &&
	backgroundReactionMeta?.textContent?.includes('后台更新回应') === true,
	'主要通知完成后必须停止转圈并明确显示回应仍在后台更新',
);
notificationRefresh.click();
await flushMicrotasks();
assert(
	gateway.requests.filter((request) => request.group === 'reactions').length ===
		reactionRequestsBeforeBackgroundRefresh + 1,
	'回应后台更新期间再次主动刷新必须复用同一回应请求',
);
gateway.reactionBarrier = null;
releaseBackgroundReaction();
await flushMicrotasks();
assert(
	!backgroundReactionMeta?.textContent?.includes('后台更新回应') &&
	notificationRefresh.getAttribute('aria-label') === '通知更新完成',
	'回应后台更新结束后必须自动清除独立状态并保留本轮成功反馈',
);
notificationToggleTop = 72;
	await controller.selectGroup('replies');
assert(
	template.notificationModeTabs.length === 2 &&
		template.notificationGroupTabs.length === 14 &&
		template.notificationGroupTabs.slice(0, 8)
		.map((tab) => READER_NOTIFICATION_GROUPS[
			tab.dataset.notificationGroup as ReaderNotificationGroupKey
		].label).join(',') ===
			'全部,回复,Boost,回应与赞,@提及,编辑,链接,其他' &&
	template.notificationGroupTabs.every((tab) => {
		const group = tab.dataset.notificationGroup as
			ReaderNotificationGroupKey;
		const count = controller.snapshot.groupCounts.get(group) ?? 0;
		return tab.querySelector('.ldp-collection-tab-count')?.textContent ===
			String(count) &&
			tab.getAttribute('aria-label') ===
				`${READER_NOTIFICATION_GROUPS[group].label}，${count} 条`;
	}) &&
	!template.notificationsPopover.hidden &&
		template.notificationList.querySelectorAll(
			'.ldp-notification-message-item',
		).length === controller.snapshot.records.length &&
		template.notificationList.querySelector(
			'[data-reader-target-source="notification"]' +
				'[data-reader-target-interception="off"]',
		) !== null &&
		[...template.notificationList.querySelectorAll<HTMLElement>(
			'.ldp-user-avatar-card[data-user-card][data-user-card-hover-only]',
		)].length === controller.snapshot.records.filter((record) =>
			Boolean(record.actor)).length &&
		template.notificationList.querySelectorAll(
			'.ldp-notification-read-state',
		).length === controller.snapshot.records.length &&
		[...template.notificationList.querySelectorAll<HTMLElement>(
			'.ldp-notification-message-item',
		)].every((item) => {
			const state = item.dataset.notificationReadState;
			return (state === 'read' || state === 'unread') &&
				item.querySelector('.ldp-notification-read-state')?.textContent ===
					(state === 'unread' ? '未读' : '已读');
		}) &&
		template.notificationsPopover.querySelector(
			'.ldp-collection-cache-progress [role="progressbar"]',
		) !== null,
		'View 必须完整投影分类、缓存进度、逐条已读状态、消息目标与头像用户卡触发契约',
);
	assert(
		template.notificationCategoryFilter.options.length === 3 &&
		template.notificationTagFilter.options.length === 2 &&
		template.notificationCategoryFilter.options[0]?.textContent === '类别' &&
		template.notificationTagFilter.options[0]?.textContent === '标签',
		'View 必须在搜索旁投影当前消息分类的紧凑类别与标签选项',
	);
	const notificationFilterToggle = template.notificationsPopover
		.querySelector<HTMLButtonElement>('.ldp-notification-filter-toggle');
	const notificationFilterPanel = template.notificationsPopover
		.querySelector<HTMLElement>('.ldp-user-observation-filter-panel');
	assert(
		notificationFilterToggle !== null &&
			notificationFilterPanel?.hidden === true,
		'消息搜索必须复用用户观察的折叠筛选入口',
	);
	notificationFilterToggle.click();
	assert(
		notificationFilterPanel?.hidden === false &&
			notificationFilterToggle.getAttribute('aria-expanded') === 'true' &&
			notificationFilterPanel.querySelector(
				'.ldp-user-observation-calendar-toggle',
			) !== null &&
			notificationFilterPanel.querySelector(
				'.ldp-user-observation-sort-filter',
			) !== null &&
			notificationFilterPanel.querySelector(
				'.ldp-user-observation-sort-direction',
			) !== null &&
			notificationFilterPanel.querySelector(
				'.ldp-user-observation-filter-reset',
			) !== null,
		'消息筛选入口必须完整复用用户观察的类别、标签、日历、排序和重置控件',
	);
	const notificationCalendarToggle = notificationFilterPanel.querySelector<
		HTMLButtonElement
	>('.ldp-user-observation-calendar-toggle')!;
	notificationCalendarToggle.click();
	const emptyNotificationDay = notificationFilterPanel.querySelector<
		HTMLButtonElement
	>('.ldp-user-observation-calendar-day[data-activity-level="0"]');
	assert(
		notificationFilterPanel.querySelectorAll(
			'.ldp-user-observation-calendar-grid > *',
		).length === 42 && emptyNotificationDay?.disabled === true,
		'消息活动日历必须投影完整六周网格，并禁用没有记录的日期',
	);
	emptyNotificationDay?.click();
	assert(
		controller.snapshot.dateFilter === '',
		'三类集合共用的活动日历不得用空日期把当前列表筛空',
	);
	notificationCalendarToggle.click();
	const notificationDirection = notificationFilterPanel.querySelector<
		HTMLButtonElement
	>('.ldp-user-observation-sort-direction')!;
	notificationDirection.click();
	assert(
		controller.snapshot.sortDirection === 'asc',
		'消息排序方向必须提交给本地缓存投影 owner',
	);
	notificationFilterPanel.querySelector<HTMLButtonElement>(
		'.ldp-user-observation-filter-reset',
	)!.click();
	assert(
		controller.snapshot.sortDirection === 'desc' &&
			controller.snapshot.dateFilter === '',
		'消息重置必须恢复默认日期与时间降序',
	);
const visibleNotification = template.notificationList.querySelector(
	'.ldp-notification-message-item',
);
assert(
	Boolean(visibleNotification?.querySelector(
		'.ldp-notification-type-icon svg[data-ldp-reader-icon]',
	)) &&
	visibleNotification?.querySelector(
		'.ldp-notification-title-text',
	)?.textContent?.endsWith('标题已删除') === true &&
	visibleNotification?.querySelector(
		'.ldp-notification-title-text',
	)?.textContent !== '标题已删除' &&
	!visibleNotification?.querySelector(
		'.ldp-notification-title-text',
	)?.textContent?.includes('测试主题') &&
	visibleNotification?.getAttribute('data-local-archive-status') === '404' &&
	visibleNotification?.getAttribute('data-local-archive-scope') === 'topic' &&
	Boolean(visibleNotification?.querySelector(
		'.ldp-notification-meta',
	)?.textContent?.includes('404 已删除 Topic')),
	'消息与回复条目必须保留动作语义，隐去已删除 Topic 原标题，并投影 404 元信息',
);
await controller.selectGroup('reactionLikes');
const reactionLikeItems = [...template.notificationList.querySelectorAll<HTMLElement>(
	'.ldp-notification-message-item',
)];
assert(
	reactionLikeItems.some((item) =>
		item.querySelector('[data-notification-group="likes"] ' +
			'[data-notification-emoji-text="heart"]')?.textContent === '❤️') &&
	reactionLikeItems.some((item) =>
		item.querySelector<HTMLImageElement>(
			'[data-notification-group="reactions"] > img.emoji',
		)?.src.endsWith('/emoji/heart.png') === true) &&
	!reactionLikeItems.some((item) =>
		item.querySelector('.ldp-notification-title-text')?.textContent
			?.includes('heart')),
	'回应与赞条目必须在标题左侧显示真实心形和回应 emoji，标题不显示字段名',
);
	const otherDisplayRecord = normalizeNativeNotification({
		id: 990,
		notification_type: 14,
		read: false,
		created_at: '2026-08-17T00:10:00.000Z',
		data: { display_username: 'solver' },
	}, {
		actor: 'solver',
		typeName: 'custom',
		typeLabel: '已解决',
		summary: '你的回答已被采纳',
	}, 'other');
	controller.applySyncedHistoryRecords([otherDisplayRecord]);
	await controller.selectGroup('other');
	const otherDisplayItem = template.notificationList.querySelector<HTMLElement>(
		'.ldp-notification-message-item',
	);
	assert(
		controller.snapshot.records.length === 1 &&
		otherDisplayItem?.dataset.notificationType === 'custom' &&
		otherDisplayItem.querySelector<HTMLElement>(
			'.ldp-notification-type-icon',
		)?.title === '已解决' &&
		otherDisplayItem.querySelector<HTMLElement>(
			'.ldp-notification-type-icon',
		)?.dataset.notificationIcon === 'solution-badge' &&
		Boolean(otherDisplayItem.querySelector(
			'.ldp-notification-type-icon [data-icon="solution-badge"]',
		)) &&
		otherDisplayItem.querySelector('.ldp-notification-title-text')?.textContent ===
			'【已解决】你的回答已被采纳',
		'“其他”必须在每条信息前标注原生展示模型解析出的具体通知类型',
	);
	const rawOtherLabels = [
		normalizeNativeNotification({
			id: 991,
			data: { title: 'solved.notification.title' },
		}, { typeName: 'custom', typeLabel: 'custom' }, 'other'),
		normalizeNativeNotification({ id: 992 }, {
			typeName: 'following_created_topic',
			typeLabel: 'following_created_topic',
		}, 'other'),
		normalizeNativeNotification({ id: 993 }, {
			typeName: 'topic_reminder',
			typeLabel: 'topic_reminder',
		}, 'other'),
		normalizeNativeNotification({ id: 994 }, {
			typeName: 'post_approved',
			typeLabel: 'post_approved',
		}, 'other'),
	];
	assert(
		rawOtherLabels.map((record) => record.typeLabel).join('|') ===
			'您的帖子被标记为解决方案|您关注的人新话题|话题提醒|已批准帖子' &&
		rawOtherLabels.map((record) => record.icon).join('|') ===
			'solution-badge|followed-topic|calendar-clock|post-approved',
		'宿主展示模型不可用时，“其他”仍须把已知原生类型和 custom 翻译键转成可读中文',
	);
	const migratedSolvedRecord = normalizeStoredReaderNotification({
		...rawOtherLabels[0],
		icon: 'check-square',
	});
	assert(
		migratedSolvedRecord?.icon === 'solution-badge',
		'读取历史缓存时必须把解决方案通知的旧通用图标迁移为专属 SVG',
	);
		await controller.selectGroup('replies');
	const LinkedomEvent = (
		parsedDocument.defaultView as unknown as { Event: typeof Event }
	).Event;
	Object.defineProperty(template.notificationCategoryFilter, 'value', {
		configurable: true,
		writable: true,
		value: 'category:10',
	});
	template.notificationCategoryFilter.dispatchEvent(
		new LinkedomEvent('change'),
	);
	assert(
		controller.snapshot.categoryFilter === 'category:10' &&
		controller.snapshot.records.length > 0 &&
		controller.snapshot.records.some((record) => record.actor === 'bob') &&
		controller.snapshot.records.every((record) =>
			readerNotificationCategoryFilterKey(record) === 'category:10'),
		'View 类别下拉必须只把筛选意图提交给 controller',
	);
	template.notificationCategoryFilter.value = '';
	template.notificationCategoryFilter.dispatchEvent(
		new LinkedomEvent('change'),
	);
	template.notificationSearch.value = '回复正文';
template.notificationSearch.dispatchEvent(new LinkedomEvent('input'));
assert(
	controller.snapshot.query === '回复正文' &&
	!template.notificationSearchClear.hidden,
	'View 搜索输入必须只提交给 controller',
);
template.notificationSearchClear.click();
await controller.selectGroup('all');
const modifierNotification = template.notificationList.querySelector<HTMLElement>(
	'.ldp-notification-message-item.unread',
);
assert(modifierNotification !== null, '全部通知必须保留可点击的未读记录');
const readCommitsBeforeModifierClick = native.readCommits;
const modifierClick = new LinkedomEvent('click', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperties(modifierClick, {
	button: { value: 0 },
	ctrlKey: { value: true },
	metaKey: { value: false },
	shiftKey: { value: false },
	altKey: { value: false },
});
modifierNotification.dispatchEvent(modifierClick);
await flushMicrotasks();
assert(
	native.readCommits === readCommitsBeforeModifierClick + 1,
	'通知修饰键/新标签点击必须保留浏览器导航，同时仍提交该通知已读',
);

deferMarkAll = true;
template.notificationMarkAll.click();
await flushMicrotasks();
assert(
	controller.snapshot.markingAll &&
	template.notificationMarkAll.disabled &&
	template.notificationMarkAll.dataset.ldpRequestBusy === '1' &&
	template.notificationMarkAll.querySelector('[data-icon="loader"]') !== null &&
	template.notificationMarkAll.textContent?.includes('处理中'),
	'全部已读提交期间必须投影禁用、busy、loader 与处理中标签',
);
const finishMarkAll = resolveMarkAllMutation;
finishMarkAll();
await flushMicrotasks();
assert(
	!controller.snapshot.markingAll &&
	native.allReadCommits === 1 &&
	template.notificationMarkAll.querySelector(
		'[data-icon="check-square"]',
	) !== null &&
	viewNotifications.at(-1) === '消息已全部标为已读',
	'全部已读成功必须提交唯一状态、恢复按钮并显示主线提示',
);
assert(
	template.notificationToolbar.classList.contains('is-empty') &&
	template.notificationUnreadStatus.hidden &&
	template.notificationUnreadStatus.textContent === '',
	'无未读消息时必须移除无用状态行：' + JSON.stringify({
		unreadCount: controller.snapshot.unreadCount,
		toolbarClass: template.notificationToolbar.className,
		statusHidden: template.notificationUnreadStatus.hidden,
		statusText: template.notificationUnreadStatus.textContent,
	}),
);

const notificationCacheBeforeClear = controller.cacheStats();
assert(
	notificationCacheBeforeClear.pages > 0 &&
		notificationCacheBeforeClear.records > 0,
	'通知 owner 必须向数据管理暴露有界热缓存统计',
);
controller.clearCache();
const notificationCacheAfterClear = controller.cacheStats();
assert(
	Number(notificationCacheAfterClear.pages) === 0 &&
		Number(notificationCacheAfterClear.records) === 0 &&
		Number(controller.snapshot.records.length) === 0,
	'数据管理清理通知缓存必须同步清空 controller 分页与当前投影',
);

view.destroy();
controller.destroy();
actions.destroy();
abort.abort();
