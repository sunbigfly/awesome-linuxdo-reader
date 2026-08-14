import type {
	ReaderTopicOfflineArtifactMetadata,
	ReaderTopicOfflineArtifactRecord,
	ReaderTopicOfflineArtifactStore,
} from '../src/archive/reader-topic-offline-artifact-repository.js';
import {
	ReaderWebDavClient,
	type ReaderWebDavRequestOptions,
} from '../src/sync/reader-webdav-client.js';
import {
	ReaderWebDavConfigRepository,
	type ReaderWebDavConfigStoragePort,
} from '../src/sync/reader-webdav-config-repository.js';
import { ReaderWebDavCoordinator } from
	'../src/sync/reader-webdav-coordinator.js';
import {
	createReaderWebDavCategorySelection,
	normalizeReaderWebDavConfig,
} from '../src/sync/reader-webdav-model.js';
import { createReaderWebDavOfflineTopicCategoryPort } from
	'../src/sync/reader-webdav-offline-topic-port.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function metadata(
	record: ReaderTopicOfflineArtifactRecord,
): ReaderTopicOfflineArtifactMetadata {
	const { html: _html, ...entry } = record;
	return Object.freeze(entry);
}

class MemoryArtifactStore implements ReaderTopicOfflineArtifactStore {
	readonly records = new Map<number, ReaderTopicOfflineArtifactRecord>();

	async list(): Promise<readonly ReaderTopicOfflineArtifactMetadata[]> {
		return Object.freeze([...this.records.values()]
			.map(metadata)
			.sort((left, right) => right.finishedAt - left.finishedAt));
	}

	async read(topicId: number): Promise<ReaderTopicOfflineArtifactRecord | null> {
		return this.records.get(topicId) ?? null;
	}

	async write(record: ReaderTopicOfflineArtifactRecord): Promise<void> {
		this.records.set(record.topicId, Object.freeze({ ...record }));
	}

	async remove(
		topicId: number,
		options: Readonly<{ readonly preserveHtml?: boolean }> = {},
	): Promise<void> {
		if (options.preserveHtml !== true) this.records.delete(topicId);
	}
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
	readonly contentType: string;
}

class MemoryObjectWebDavServer {
	readonly files = new Map<string, StoredObject>();
	readonly requests: ReaderWebDavRequestOptions[] = [];
	readonly failedReads = new Set<string>();

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
				if (this.failedReads.has(options.url)) {
					options.onload({ status: 503 });
					return;
				}
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
			const expected = current
				? options.headers['If-Match'] === `\"v${current.version}\"`
				: options.headers['If-None-Match'] === '*';
			if (!expected) {
				options.onload({ status: 412 });
				return;
			}
			const version = (current?.version ?? 0) + 1;
			this.files.set(options.url, Object.freeze({
				text: String(options.data ?? ''),
				version,
				contentType: options.headers['Content-Type'] ?? '',
			}));
			options.onload({
				status: current ? 204 : 201,
				responseHeaders: `ETag: \"v${version}\"`,
			});
		});
		return { abort() {} };
	};
}

async function repository(
	writerId: string,
): Promise<ReaderWebDavConfigRepository> {
	const result = new ReaderWebDavConfigRepository({
		storage: new MemoryValueStorage(),
		createWriterId: () => writerId,
	});
	await result.load();
	await result.saveConfig(normalizeReaderWebDavConfig({
		endpoint: 'https://dav.example.test/dav/',
		username: 'offline-user',
		password: 'offline-application-password',
		remotePath: 'ALR-Lite/v2/sync.json',
		categories: createReaderWebDavCategorySelection({
			'offline-topics': true,
		}),
		autoSyncEnabled: false,
		autoSyncIntervalMinutes: 60,
	}));
	return result;
}

function coordinator(
	client: ReaderWebDavClient,
	repository: ReaderWebDavConfigRepository,
	store: ReaderTopicOfflineArtifactStore,
): ReaderWebDavCoordinator {
	return new ReaderWebDavCoordinator({
		client,
		repository,
		categories: [createReaderWebDavOfflineTopicCategoryPort(store)],
		hostname: () => 'linux.do',
		username: () => 'reader-account',
	});
}

const server = new MemoryObjectWebDavServer();
const client = new ReaderWebDavClient({ request: server.request });
const sourceStore = new MemoryArtifactStore();
const targetStore = new MemoryArtifactStore();
const largeHtml = '<!doctype html><html><head><title>离线大帖</title></head>' +
	'<body><main data-offline-topic="314">完整离线正文</main>' +
	'x'.repeat(2 * 1024 * 1024 + 4_096) +
	'</body></html>';
const sourceArtifact = Object.freeze({
	topicId: 314,
	title: 'WebDAV 跨设备离线大帖',
	selectionMode: 'custom' as const,
	selectionExpression: '1,3,8-12',
	html: largeHtml,
	filename: 'webdav-offline-topic-314.html',
	postCount: 7,
	expectedPostCount: 7,
	complete: true,
	archiveStatus: 404,
	createdAt: 10_000,
	finishedAt: 20_000,
	localDownloadRequestedAt: 21_000,
} satisfies ReaderTopicOfflineArtifactRecord);
await sourceStore.write(sourceArtifact);

const sourceCoordinator = coordinator(
	client,
	await repository('offline-device-a'),
	sourceStore,
);
const targetCoordinator = coordinator(
	client,
	await repository('offline-device-b'),
	targetStore,
);
const upload = await sourceCoordinator.syncNow();
const manifestEntry = [...server.files.entries()].find(([url]) =>
	url.endsWith('/manifest.json'));
const htmlEntry = [...server.files.entries()].find(([url]) =>
	url.endsWith('.html'));
const mainEntry = [...server.files.entries()].find(([url]) =>
	url.endsWith('/sync.json'));
assert(
	upload.uploaded === 1 &&
	upload.remoteCreated &&
	!mainEntry &&
	!server.requests.some((request) => request.url.endsWith('/sync.json')) &&
	Boolean(manifestEntry) &&
	Boolean(htmlEntry) &&
	htmlEntry![1].text === largeHtml &&
	htmlEntry![1].contentType === 'text/html; charset=utf-8' &&
	manifestEntry![1].text.length < 20_000 &&
	!manifestEntry![1].text.includes('完整离线正文') &&
	manifestEntry![1].text.includes('webdav-offline-topic-314.html') &&
	manifestEntry![1].text.includes('"archiveStatus":404'),
	'离线 Topic 必须使用轻量清单加独立完整 HTML；仅选该类别时不得读取或创建 sync.json，也不能受主文件格式或 2 MiB 上限阻断',
);
assert(
	!server.requests.some((request) =>
		request.url.includes('offline-application-password') ||
		request.url.includes('offline-user')) &&
	![...server.files.values()].some((file) =>
		file.text.includes('offline-application-password')),
	'WebDAV 离线 HTML 链路不得把连接凭据写入 URL、清单或对象',
);

const download = await targetCoordinator.syncNow();
const restored = await targetStore.read(314);
assert(
	download.imported === 1 &&
	restored?.html === largeHtml &&
	restored.title === sourceArtifact.title &&
	restored.selectionMode === 'custom' &&
	restored.selectionExpression === '1,3,8-12' &&
	restored.filename === sourceArtifact.filename &&
	restored.archiveStatus === 404 &&
	restored.localDownloadRequestedAt === 21_000,
	'另一设备必须把清单元数据、存档状态与独立 HTML 水合回同一个本地离线 Artifact 结构体',
);

const localOnlyChange = Object.freeze({
	...restored!,
	title: '远端失败时必须保留的本机离线帖',
	finishedAt: 30_000,
});
await targetStore.write(localOnlyChange);
server.failedReads.add(manifestEntry![0]);
let readFailure = '';
try {
	await targetCoordinator.syncNow();
} catch (cause) {
	readFailure = cause instanceof Error ? cause.message : '';
}
assert(
	readFailure.includes('HTTP 503') &&
	(await targetStore.read(314))?.title === localOnlyChange.title,
	'离线清单读取失败时不得覆盖或清除本机完整 HTML Artifact',
);
server.failedReads.delete(manifestEntry![0]);

const update = await targetCoordinator.syncNow();
const receiveUpdate = await sourceCoordinator.syncNow();
assert(
	update.uploaded === 1 &&
	receiveUpdate.imported === 1 &&
	(await sourceStore.read(314))?.title === localOnlyChange.title,
	'本机恢复后更新的离线 Artifact 元数据必须继续通过清单跨设备合并',
);

await targetStore.remove(314);
const remove = await targetCoordinator.syncNow();
const receiveRemove = await sourceCoordinator.syncNow();
assert(
	remove.deleted === 1 &&
	receiveRemove.imported === 1 &&
	await sourceStore.read(314) === null &&
	JSON.parse(manifestEntry![1].text).records['314'].deleted !== true &&
	JSON.parse(server.files.get(manifestEntry![0])!.text)
		.records['314'].deleted === true,
	'删除离线 Topic 必须通过清单墓碑传播，并在另一设备清理同一 Artifact 记录',
);

const activeManifest = JSON.parse(manifestEntry![1].text) as {
	records: Record<string, unknown>;
};
const currentManifest = server.files.get(manifestEntry![0])!;
server.files.set(manifestEntry![0], Object.freeze({
	...currentManifest,
	version: currentManifest.version + 1,
	text: JSON.stringify({
		...activeManifest,
		records: { '315': activeManifest.records['314'] },
	}),
}));
const mismatchedStore = new MemoryArtifactStore();
const mismatchedCoordinator = coordinator(
	client,
	await repository('offline-device-corrupt-manifest'),
	mismatchedStore,
);
let identityFailure = '';
try {
	await mismatchedCoordinator.syncNow();
} catch (cause) {
	identityFailure = cause instanceof Error ? cause.message : '';
}
assert(
	identityFailure.includes('清单记录身份不一致') &&
	mismatchedStore.records.size === 0,
	'离线清单键与内部 Topic 身份不一致时必须拒绝整轮应用，不能把正文写入错误 Topic',
);
