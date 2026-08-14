import {
	normalizeReaderWebDavDocument,
	reconcileReaderWebDavRecords,
	type ReaderWebDavBaseline,
	type ReaderWebDavLocalRecord,
	type ReaderWebDavRemoteRecord,
} from '../src/sync/reader-webdav-model.js';
import {
	mergeReaderWebDavConnectHistoryValues,
	mergeReaderWebDavHistoryValues,
} from '../src/sync/reader-webdav-category-ports.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function queue(ids: readonly number[]): readonly ReaderWebDavLocalRecord[] {
	return Object.freeze(ids.map((topicId) => Object.freeze({
		id: String(topicId),
		value: Object.freeze({
			topicId,
			title: `Topic ${topicId}`,
			href: `/t/${topicId}`,
			addedAt: 1_000 + topicId,
			pinned: topicId === 4,
		}),
	})));
}

const mergeQueue = (local: unknown): unknown => local;

const deviceAUpload = reconcileReaderWebDavRecords({
	local: queue([1, 2, 3, 4]),
	remote: {},
	writerId: 'device-a',
	now: 10_000,
	initialStrategy: 'merge',
	mergeValues: mergeQueue,
});
assert(
	deviceAUpload.uploaded === 4 &&
	deviceAUpload.active.length === 4 &&
	Object.keys(deviceAUpload.records).length === 4,
	'设备 A 首次同步必须把四个阅读队列记录写入远端模型',
);

const deviceBDownload = reconcileReaderWebDavRecords({
	local: [],
	remote: deviceAUpload.records,
	writerId: 'device-b',
	now: 20_000,
	initialStrategy: 'merge',
	mergeValues: mergeQueue,
});
assert(
	deviceBDownload.imported === 4 &&
	deviceBDownload.active.map((entry) => entry.id).join(',') === '1,2,3,4' &&
	deviceBDownload.changed === false,
	'空白设备 B 首次同步必须下载四个队列，不能把远端覆盖为空',
);

const deviceBDelete = reconcileReaderWebDavRecords({
	local: [],
	remote: deviceAUpload.records,
	baseline: deviceBDownload.baseline,
	writerId: 'device-b',
	now: 30_000,
	initialStrategy: 'merge',
	mergeValues: mergeQueue,
});
assert(
	deviceBDelete.active.length === 0 &&
	deviceBDelete.deleted === 4 &&
	Object.values(deviceBDelete.records).every((entry) => entry.deleted),
	'设备 B 已建立同步基线后清空队列，必须上传四个删除墓碑',
);

const deviceAReceiveDelete = reconcileReaderWebDavRecords({
	local: queue([1, 2, 3, 4]),
	remote: deviceBDelete.records,
	baseline: deviceAUpload.baseline,
	writerId: 'device-a',
	now: 40_000,
	initialStrategy: 'merge',
	mergeValues: mergeQueue,
});
assert(
	deviceAReceiveDelete.active.length === 0 &&
	deviceAReceiveDelete.imported === 4 &&
	deviceAReceiveDelete.changed === false,
	'设备 A 再同步必须接收设备 B 的四个删除，而不是复活旧队列',
);

const stableDelete = reconcileReaderWebDavRecords({
	local: [],
	remote: deviceBDelete.records,
	baseline: deviceBDelete.baseline,
	writerId: 'device-b',
	now: 50_000,
	initialStrategy: 'merge',
	mergeValues: mergeQueue,
});
assert(
	!stableDelete.changed &&
	stableDelete.uploaded === 0 &&
	stableDelete.imported === 0 &&
	stableDelete.deleted === 0 &&
	JSON.stringify(stableDelete.records) === JSON.stringify(deviceBDelete.records),
	'本机已删除且远端已有墓碑时必须保持稳定，不能每轮重写墓碑并重复计入上传或删除',
);

const baseline: ReaderWebDavBaseline['queue'] = Object.freeze({
	'8': deviceAUpload.baseline['1']!,
});
const remoteChanged: Readonly<Record<string, ReaderWebDavRemoteRecord>> =
	Object.freeze({
		'8': Object.freeze({
			changedAt: 50_000,
			writerId: 'device-b',
			deleted: false,
			value: Object.freeze({
				topicId: 8,
				title: 'Remote title',
				href: '/t/8',
				addedAt: 1_008,
				pinned: false,
			}),
		}),
	});
const remoteWinsDeleteConflict = reconcileReaderWebDavRecords({
	local: [],
	remote: remoteChanged,
	baseline,
	writerId: 'device-a',
	now: 60_000,
	initialStrategy: 'merge',
	mergeValues: mergeQueue,
});
assert(
	remoteWinsDeleteConflict.active.length === 1 &&
	remoteWinsDeleteConflict.conflicts === 1 &&
	remoteWinsDeleteConflict.uploaded === 0,
	'本地删除与远端修改并发时必须保留远端记录，避免覆盖式丢失',
);

const concurrentMerge = reconcileReaderWebDavRecords({
	local: [Object.freeze({
		id: '9',
		value: Object.freeze({ tags: ['local'], viewedAt: 90 }),
	})],
	remote: Object.freeze({
		'9': Object.freeze({
			changedAt: 70_000,
			writerId: 'device-b',
			deleted: false,
			value: Object.freeze({ tags: ['remote'], viewedAt: 80 }),
		}),
	}),
	baseline: Object.freeze({ '9': 'value:previous' }),
	writerId: 'device-a',
	now: 80_000,
	initialStrategy: 'merge',
	mergeValues: (localValue, remoteValue) => {
		const local = localValue as { tags: readonly string[]; viewedAt: number };
		const remote = remoteValue as { tags: readonly string[]; viewedAt: number };
		return Object.freeze({
			tags: Object.freeze([...new Set([...local.tags, ...remote.tags])]),
			viewedAt: Math.max(local.viewedAt, remote.viewedAt),
		});
	},
});
const merged = concurrentMerge.active[0]?.value as {
	readonly tags?: readonly string[];
	readonly viewedAt?: number;
};
assert(
	concurrentMerge.conflicts === 1 &&
	concurrentMerge.uploaded === 1 &&
	concurrentMerge.imported === 1 &&
	merged.tags?.join(',') === 'local,remote' &&
	merged.viewedAt === 90,
	'并发活动记录必须通过分类合并器生成一个确定结果',
);

const mergedLegacyHistory = mergeReaderWebDavHistoryValues(
	Object.freeze({
		topicId: 42,
		title: '较新的旧客户端记录',
		postsCount: 3,
		postNumber: 3,
		readPostNumbers: [1, 3],
		firstViewedAt: 100,
		viewedAt: 300,
	}),
	Object.freeze({
		topicId: 42,
		title: '较早的完整记录',
		postsCount: 2,
		topicSubtitle: '2 帖 · 20 浏览',
		categoryId: 7,
		categoryName: '开发调优',
		tags: ['Reader', 'OpenAI'],
		viewport: {
			postNumber: 2,
			postOffset: 12,
			scrollTop: 480,
			scrollRange: 1_200,
			scrollRatio: 0.4,
		},
		postNumber: 2,
		readPostNumbers: [2],
		firstViewedAt: 50,
		viewedAt: 200,
	}),
) as Readonly<{
	topicSubtitle: string;
	categoryId: number | null;
	categoryName: string;
	tags: readonly string[];
	viewport: Readonly<{ scrollRatio?: number }> | null;
	postNumber: number;
	readPostNumbers: readonly number[];
	firstViewedAt: number;
	viewedAt: number;
}>;
assert(
	mergedLegacyHistory.postNumber === 3 &&
	mergedLegacyHistory.readPostNumbers.join(',') === '1,2,3' &&
	mergedLegacyHistory.firstViewedAt === 50 &&
	mergedLegacyHistory.viewedAt === 300 &&
	mergedLegacyHistory.topicSubtitle === '2 帖 · 20 浏览' &&
	mergedLegacyHistory.categoryId === 7 &&
	mergedLegacyHistory.categoryName === '开发调优' &&
	mergedLegacyHistory.tags.join(',') === 'Reader,OpenAI' &&
	mergedLegacyHistory.viewport?.scrollRatio === 0.4,
	'WebDAV 合并较新旧客户端记录时必须保留较早完整记录的元数据与高度锚点',
);

const mergedConnectHistory = mergeReaderWebDavConnectHistoryValues(
	Object.freeze({
		version: 1,
		days: Object.freeze({
			'2026-08-13': Object.freeze({
				'likes-given': Object.freeze({
					first: 12,
					last: 30,
					firstObservedAt: 200,
					lastObservedAt: 400,
				}),
			}),
		}),
		readTrackingStartedAt: 200,
		confirmedReads: Object.freeze({ '42:7': 300 }),
	}),
	Object.freeze({
		version: 1,
		days: Object.freeze({
			'2026-08-13': Object.freeze({
				'likes-given': Object.freeze({
					first: 10,
					last: 20,
					firstObservedAt: 100,
					lastObservedAt: 250,
				}),
			}),
		}),
		readTrackingStartedAt: 100,
		confirmedReads: Object.freeze({ '42:7': 250, '42:8': 350 }),
	}),
) as Readonly<{
	days: Readonly<{
		[day: string]: Readonly<{
			[key: string]: Readonly<{
				first: number;
				last: number;
				firstObservedAt: number;
				lastObservedAt: number;
			}>;
		}>;
	}>;
	readTrackingStartedAt: number;
	confirmedReads: Readonly<Record<string, number>>;
}>;
const mergedConnectSample = mergedConnectHistory.days['2026-08-13']
	?.['likes-given'];
assert(
	mergedConnectSample?.first === 10 &&
	mergedConnectSample.last === 30 &&
	mergedConnectSample.firstObservedAt === 100 &&
	mergedConnectSample.lastObservedAt === 400 &&
	mergedConnectHistory.readTrackingStartedAt === 100 &&
	mergedConnectHistory.confirmedReads['42:7'] === 250 &&
	mergedConnectHistory.confirmedReads['42:8'] === 350,
	'Connect 历史必须按观察时间合并首末样本并单调合并已确认阅读，不能由本机浅覆盖远端数据',
);

const prototypeDocument = normalizeReaderWebDavDocument(JSON.parse(`{
	"format":"awesome-linuxdo-reader-lite-webdav",
	"schemaVersion":2,
	"updatedAt":1,
	"writerId":"remote",
	"scopes":{
		"__proto__":{"categories":{}},
		"site:linux.do|account:reader":{"categories":{"queue":{"records":{
			"__proto__":{"changedAt":1,"writerId":"remote","deleted":false,"value":{"topicId":1}}
		}}}}
	}
}`));
const prototypeRecords = prototypeDocument.scopes[
	'site:linux.do|account:reader'
]?.categories.queue?.records;
const prototypeReconcile = reconcileReaderWebDavRecords({
	local: [Object.freeze({ id: '__proto__', value: 'local-record' })],
	remote: {},
	writerId: 'device-safe-map',
	now: 1,
	initialStrategy: 'merge',
	mergeValues: (local) => local,
});
assert(
	Object.getPrototypeOf(prototypeDocument.scopes) === null &&
	Object.hasOwn(prototypeDocument.scopes, '__proto__') &&
	prototypeRecords !== undefined &&
	Object.getPrototypeOf(prototypeRecords) === null &&
	Object.hasOwn(prototypeRecords, '__proto__') &&
	Object.getPrototypeOf(prototypeReconcile.records) === null &&
	prototypeReconcile.active[0]?.id === '__proto__',
	'WebDAV 远端 scope 与记录 ID 必须写入无原型字典，保留合法字符串键且不能污染对象原型',
);
