import {
	ReaderImageDownloadService,
	type BlobDownloadPort,
} from '../src/media/reader-image-download-service.js';
import type { ReaderImageResourceService } from '../src/media/reader-image-resource-service.js';
import type { ReaderLightboxItem } from '../src/media/reader-lightbox-controller.js';
import {
	createStoredZip,
	storedZipCrc32,
} from '../src/media/stored-zip.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const first: ReaderLightboxItem = {
	key: '10:1:0',
	topicId: 10,
	sourcePostNumber: 1,
	imageOrder: 0,
	previewSrc: 'https://linux.do/a-small.png',
	originalSrc: 'https://linux.do/a.png',
	alt: 'A',
};
const second: ReaderLightboxItem = {
	...first,
	key: '10:2:0',
	sourcePostNumber: 2,
	previewSrc: 'https://linux.do/b-small.jpg',
	originalSrc: 'https://linux.do/b.jpg',
	alt: 'B',
};
const requested: string[] = [];
const resources = {
	async blob(item: ReaderLightboxItem) {
		requested.push(item.key);
		if (item === second) throw new Error('broken');
		return new Blob(['one'], { type: 'image/png' });
	},
} as unknown as ReaderImageResourceService;
const saves: Array<{ blob: Blob; filename: string }> = [];
const downloads: BlobDownloadPort = {
	save(blob, filename) {
		saves.push({ blob, filename });
	},
};
const service = new ReaderImageDownloadService({
	resources,
	downloads,
	now: () => new Date(2026, 6, 29, 12, 34, 56),
});
const filename = await service.download(first, 0, { original: true });
assert(
	filename === 'a.png' &&
	saves[0]?.filename === 'a.png',
	'单图下载必须复用同一取源和命名路径',
);
const phases: string[] = [];
const result = await service.batch([first, second], {
	archiveName: 'topic/images.zip',
	original: false,
	onProgress: (progress) => phases.push(progress.phase),
});
assert(
	result.saved === 1 &&
	result.failures.length === 1 &&
	result.archiveName === 'topic_images.zip' &&
	saves.at(-1)?.filename === 'topic_images.zip' &&
	saves.at(-1)?.blob.type === 'application/zip' &&
	phases.join(',') === 'fetching,fetching,archiving,saved',
	'批量下载必须容忍局部失败，并只通过共用保存端口输出一个 ZIP',
);
assert(
	requested.join(',') === `${first.key},${first.key},${second.key}`,
	'单图和批量路径必须共用同一个 Blob owner',
);
assert(
	storedZipCrc32(new TextEncoder().encode('123456789')) === 0xcbf43926,
	'共享 ZIP CRC32 实现必须符合标准向量',
);
const zip = createStoredZip(
	[{ name: '一.png', bytes: new Uint8Array([1, 2, 3]) }],
	{ modifiedAt: new Date(2026, 6, 29) },
);
const bytes = new Uint8Array(await zip.arrayBuffer());
assert(
	new DataView(bytes.buffer).getUint32(0, true) === 0x04034b50 &&
	new DataView(bytes.buffer).getUint32(bytes.length - 22, true) === 0x06054b50,
	'共享归档器必须输出合法 local/end ZIP signature',
);
