import {
	reconcileReaderWebDavRecords,
	type ReaderWebDavBaseline,
	type ReaderWebDavLocalRecord,
	type ReaderWebDavRemoteRecord,
} from '../src/sync/reader-webdav-model.js';

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
