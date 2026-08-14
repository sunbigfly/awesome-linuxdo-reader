import {
	discoursePostId,
	discoursePostNumber,
	discourseTopicId,
} from '../src/discourse/identifiers.js';
import type { ReaderBookmarkRecord } from
	'../src/bookmark/reader-bookmark-model.js';
import type { ReaderNotificationRecord } from
	'../src/notification/reader-notification-model.js';
import {
	createReaderWebDavActivityHistoryCategoryPort,
	createReaderWebDavNotificationHistoryCategoryPort,
	type ReaderActivityHistorySyncPort,
	type ReaderNotificationHistorySyncPort,
} from '../src/sync/reader-webdav-category-ports.js';
import {
	ReaderWebDavClient,
	type ReaderWebDavRequestOptions,
} from '../src/sync/reader-webdav-client.js';
import {
	ReaderWebDavConfigRepository,
	type ReaderWebDavConfigStoragePort,
} from '../src/sync/reader-webdav-config-repository.js';
import {
	ReaderWebDavCoordinator,
	type ReaderWebDavCategoryPort,
} from '../src/sync/reader-webdav-coordinator.js';
import {
	READER_WEBDAV_CATEGORIES,
	createReaderWebDavCategorySelection,
	normalizeReaderWebDavConfig,
} from '../src/sync/reader-webdav-model.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class MemoryValueStorage implements ReaderWebDavConfigStoragePort {
	value: unknown = null;

	async getValue(): Promise<unknown> {
		return this.value;
	}

	async setValue(_key: string, value: unknown): Promise<void> {
		this.value = structuredClone(value);
	}
}

interface StoredObject {
	readonly text: string;
	readonly version: number;
}

class MemoryObjectWebDavServer {
	readonly files = new Map<string, StoredObject>();
	readonly requests: ReaderWebDavRequestOptions[] = [];

	request = (options: ReaderWebDavRequestOptions): { abort(): void } => {
		this.requests.push(options);
		queueMicrotask(() => {
			if (options.method === 'MKCOL') {
				options.onload({ status: 405 });
				return;
			}
			if (options.method === 'PROPFIND') {
				options.onload({ status: 207 });
				return;
			}
			if (options.method === 'GET') {
				const file = this.files.get(options.url);
				options.onload(file
					? {
							status: 200,
							responseText: file.text,
							responseHeaders: `ETag: \"v${file.version}\"`,
						}
					: { status: 404 });
				return;
			}
			const current = this.files.get(options.url);
			const matches = current
				? options.headers['If-Match'] === `\"v${current.version}\"`
				: options.headers['If-None-Match'] === '*';
			if (!matches) {
				options.onload({ status: 412 });
				return;
			}
			const version = (current?.version ?? 0) + 1;
			this.files.set(options.url, Object.freeze({
				text: String(options.data ?? ''),
				version,
			}));
			options.onload({
				status: current ? 204 : 201,
				responseHeaders: `ETag: \"v${version}\"`,
			});
		});
		return { abort() {} };
	};
}

class NotificationHistoryState implements ReaderNotificationHistorySyncPort {
	records: readonly ReaderNotificationRecord[];

	constructor(records: readonly ReaderNotificationRecord[] = []) {
		this.records = Object.freeze([...records]);
	}

	syncHistoryRecords(): readonly ReaderNotificationRecord[] {
		return this.records;
	}

	applySyncedHistoryRecords(records: readonly ReaderNotificationRecord[]): void {
		this.records = Object.freeze([...records]);
	}
}

class ActivityHistoryState implements ReaderActivityHistorySyncPort {
	records: readonly ReaderBookmarkRecord[];

	constructor(records: readonly ReaderBookmarkRecord[] = []) {
		this.records = Object.freeze([...records]);
	}

	activitySyncRecords(): readonly ReaderBookmarkRecord[] {
		return this.records;
	}

	applySyncedActivityRecords(records: readonly ReaderBookmarkRecord[]): void {
		this.records = Object.freeze([...records]);
	}
}

function notification(
	identity: string,
	group: ReaderNotificationRecord['group'] = 'replies',
): ReaderNotificationRecord {
	return Object.freeze({
		identity,
		group,
		source: group === 'inbox' ? 'private-messages' : 'user-actions',
		sourceNotificationId: 9001,
		notificationTypeId: 1,
		highPriority: true,
		typeName: 'replied',
		typeLabel: '回复',
		aggregateCount: null,
		icon: 'reply',
		actor: 'remote-user',
		avatarFallback: 'R',
		avatarTemplate: '/u/remote-user/{size}.png',
		summary: '远端历史通知',
		excerpt: '可跨设备搜索的逐条正文',
		stateLabel: '未读',
		createdAt: '2026-08-10T01:02:03.000Z',
		read: false,
		href: '/t/webdav-history/321/7',
		target: Object.freeze({
			topicId: discourseTopicId(321),
			postNumber: discoursePostNumber(7),
		}),
		categoryId: 42,
		categoryName: '开发调优',
		tags: Object.freeze(['reader']),
		searchText: 'remote-user 远端历史通知 可跨设备搜索的逐条正文',
	});
}

function activity(
	identity: string,
	tab: ReaderBookmarkRecord['tab'],
	postNumber: number,
): ReaderBookmarkRecord {
	return Object.freeze({
		identity,
		tab,
		bookmarkId: tab === 'Topic' ? 99 : null,
		topicId: discourseTopicId(654),
		postId: tab === 'Topic' ? null : discoursePostId(6_500 + postNumber),
		postNumber: discoursePostNumber(postNumber),
		title: '跨设备活动历史',
		authorUsername: 'activity-user',
		avatarTemplate: '/u/activity-user/{size}.png',
		createdAt: `2026-08-10T01:0${postNumber}:00.000Z`,
		name: '',
		highestPostNumber: 12,
		reaction: tab === 'Reaction' ? 'heart' : '',
		excerpt: `${tab} 的历史正文`,
		categoryId: 42,
		categoryName: '开发调优',
		tags: Object.freeze(['reader']),
		searchText: `${tab} 跨设备活动历史 activity-user`,
	});
}

async function repository(
	writerId: string,
	category: 'notification-history' | 'activity-history',
): Promise<ReaderWebDavConfigRepository> {
	const result = new ReaderWebDavConfigRepository({
		storage: new MemoryValueStorage(),
		createWriterId: () => writerId,
	});
	await result.load();
	await result.saveConfig(normalizeReaderWebDavConfig({
		endpoint: 'https://dav.example.test/dav/',
		username: 'history-user',
		password: 'history-application-password',
		remotePath: 'ALR-Lite/v2/sync.json',
		categories: createReaderWebDavCategorySelection({ [category]: true }),
		autoSyncEnabled: false,
		autoSyncIntervalMinutes: 60,
	}));
	return result;
}

function coordinator(
	client: ReaderWebDavClient,
	repository: ReaderWebDavConfigRepository,
	port: ReaderWebDavCategoryPort,
): ReaderWebDavCoordinator {
	return new ReaderWebDavCoordinator({
		client,
		repository,
		categories: [port],
		hostname: () => 'linux.do',
		username: () => 'reader-account',
	});
}

const defaults = createReaderWebDavCategorySelection();
assert(
	READER_WEBDAV_CATEGORIES.length === 12 &&
	!defaults['notification-history'] &&
	!defaults['activity-history'],
	'WebDAV 必须提供十二类开关，两个历史大对象类别默认关闭',
);

const server = new MemoryObjectWebDavServer();
const client = new ReaderWebDavClient({ request: server.request });
const notificationSource = new NotificationHistoryState([
	notification('notification-history:reply'),
	notification('notification-history:private-message', 'inbox'),
]);
const notificationTarget = new NotificationHistoryState();
const notificationSourceRepository = await repository(
	'notification-device-a',
	'notification-history',
);
const notificationSourceCoordinator = coordinator(
	client,
	notificationSourceRepository,
	createReaderWebDavNotificationHistoryCategoryPort(notificationSource),
);
const notificationTargetCoordinator = coordinator(
	client,
	await repository('notification-device-b', 'notification-history'),
	createReaderWebDavNotificationHistoryCategoryPort(notificationTarget),
);
const notificationUpload = await notificationSourceCoordinator.syncNow();
const notificationManifestEntry = [...server.files.entries()].find(([url]) =>
	url.endsWith('/notification-history.json'));
const mainSyncEntry = [...server.files].find(([url]) =>
	url.endsWith('/sync.json'));
assert(notificationManifestEntry !== undefined, '通知历史必须写入独立清单');
const notificationManifest = JSON.parse(notificationManifestEntry[1].text) as {
	readonly records: Readonly<Record<string, Readonly<{
		readonly deleted: boolean;
		readonly value?: Readonly<Record<string, unknown>>;
	}>>>;
};
const notificationRemoteValues = Object.values(notificationManifest.records)
	.map((entry) => entry.value)
	.filter((entry): entry is Readonly<Record<string, unknown>> => Boolean(entry));
assert(
	notificationUpload.uploaded === 1 &&
	notificationUpload.categories === 1 &&
	notificationUpload.remoteCreated &&
	mainSyncEntry === undefined &&
	!server.requests.some((request) => request.url.endsWith('/sync.json')) &&
	notificationRemoteValues.length === 1 &&
	Object.values(notificationSourceRepository.snapshot.baselines).every(
		(baseline) => Object.keys(
			baseline['notification-history'] ?? {},
		).length === 0,
	) &&
	!Object.hasOwn(notificationRemoteValues[0]!, 'read') &&
	!Object.hasOwn(notificationRemoteValues[0]!, 'stateLabel') &&
	!Object.hasOwn(notificationRemoteValues[0]!, 'sourceNotificationId') &&
	!Object.hasOwn(notificationRemoteValues[0]!, 'notificationTypeId') &&
	!notificationManifestEntry[0].includes('reader-account'),
	'通知历史必须独立且不读取主 sync.json，并按账号指纹隔离且排除私信、已读状态与原生通知 mutation 身份',
);

const notificationDownload = await notificationTargetCoordinator.syncNow();
assert(
	notificationDownload.imported === 1 &&
	notificationTarget.records.length === 1 &&
	notificationTarget.records[0]?.identity === 'notification-history:reply' &&
	notificationTarget.records[0]?.read === null &&
	notificationTarget.records[0]?.sourceNotificationId === null &&
	notificationTarget.records[0]?.stateLabel === '',
	'空白设备必须恢复通知历史，但已读与原生通知 ID 必须继续交给 Discourse',
);

notificationTarget.records = Object.freeze([]);
const partialNotificationRefresh = await notificationTargetCoordinator.syncNow();
assert(
	partialNotificationRefresh.imported === 1 &&
	partialNotificationRefresh.deleted === 0 &&
	notificationTarget.records.length === 1 &&
	Object.values(notificationManifest.records).every((entry) => !entry.deleted),
	'本机缓存尚未回填完整时，历史同步必须重新导入远端记录，不能生成删除墓碑',
);

const activitySource = new ActivityHistoryState([
	activity('activity:reply', 'Reply', 3),
	activity('activity:boost', 'Boost', 4),
	activity('activity:reaction', 'Reaction', 5),
	activity('activity:bookmark', 'Topic', 1),
]);
const activityTarget = new ActivityHistoryState();
const activitySourceCoordinator = coordinator(
	client,
	await repository('activity-device-a', 'activity-history'),
	createReaderWebDavActivityHistoryCategoryPort(activitySource),
);
const activityTargetCoordinator = coordinator(
	client,
	await repository('activity-device-b', 'activity-history'),
	createReaderWebDavActivityHistoryCategoryPort(activityTarget),
);
const activityUpload = await activitySourceCoordinator.syncNow();
const activityDownload = await activityTargetCoordinator.syncNow();
const activityManifestEntry = [...server.files.entries()].find(([url]) =>
	url.endsWith('/activity-history.json'));
assert(
	activityUpload.uploaded === 3 &&
	activityDownload.imported === 3 &&
	activityTarget.records.map((entry) => entry.tab).sort().join(',') ===
		'Boost,Reaction,Reply' &&
	activityTarget.records.find((entry) => entry.tab === 'Reply')?.searchText
		.includes('回复') === true &&
	activityTarget.records.every((entry) =>
		entry.categoryId === 42 &&
		entry.categoryName === '开发调优' &&
		entry.tags.includes('reader')) &&
	Boolean(activityManifestEntry) &&
	!activityManifestEntry![1].text.includes('activity:bookmark') &&
	!activityManifestEntry![1].text.includes('highestPostNumber') &&
	!activityManifestEntry![1].text.includes('searchText') &&
	activityManifestEntry![1].text.includes('categoryName') &&
	activityManifestEntry![1].text.includes('tags'),
	'活动历史必须只合并三类活动，并兼容保存类别与标签供跨设备本地筛选',
);

const corruptedNotificationManifest = JSON.parse(
	notificationManifestEntry[1].text,
) as { records: Record<string, unknown> };
const notificationRecord = corruptedNotificationManifest.records[
	'notification-history:reply'
];
const currentNotificationManifest = server.files.get(
	notificationManifestEntry[0],
)!;
server.files.set(notificationManifestEntry[0], Object.freeze({
	...currentNotificationManifest,
	version: currentNotificationManifest.version + 1,
	text: JSON.stringify({
		...corruptedNotificationManifest,
		records: { 'notification-history:wrong-key': notificationRecord },
	}),
}));
const notificationBeforeCorruption = notificationTarget.records;
let notificationIdentityFailure = '';
try {
	await notificationTargetCoordinator.syncNow();
} catch (cause) {
	notificationIdentityFailure = cause instanceof Error ? cause.message : '';
}
assert(
	notificationIdentityFailure.includes('身份不一致') &&
	notificationTarget.records === notificationBeforeCorruption,
	'历史清单键与记录内部身份不一致时必须拒绝整轮应用，并保留本机历史投影',
);
