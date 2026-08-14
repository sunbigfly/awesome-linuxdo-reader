import {
	ReaderWebDavClient,
	type ReaderWebDavRequestResponse,
	type ReaderWebDavRequestOptions,
} from '../src/sync/reader-webdav-client.js';
import {
	ReaderWebDavConfigRepository,
	type ReaderWebDavConfigStoragePort,
} from '../src/sync/reader-webdav-config-repository.js';
import {
	ReaderWebDavAutoSync,
	ReaderWebDavCoordinator,
	type ReaderWebDavCategoryPort,
} from '../src/sync/reader-webdav-coordinator.js';
import {
	createReaderWebDavTranslationCacheCategoryPort,
	createReaderWebDavTranslationCategoryPort,
} from '../src/sync/reader-webdav-category-ports.js';
import {
	ResponseRepository,
	type ResponseCacheEntry,
	type ResponseCacheInvalidation,
	type ResponseCacheStore,
} from '../src/cache/response-repository.js';
import {
	createReaderWebDavCategorySelection,
	normalizeReaderWebDavConfig,
	type ReaderWebDavLocalRecord,
} from '../src/sync/reader-webdav-model.js';
import {
	ReaderTranslationConfigRepository,
	normalizeReaderTranslationConfig,
	readerTranslationActiveProfile,
} from '../src/translation/reader-translation-config.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class MemoryValueStorage implements ReaderWebDavConfigStoragePort {
	value: unknown = null;
	writes = 0;
	async getValue(): Promise<unknown> {
		return this.value;
	}
	async setValue(_key: string, value: unknown): Promise<void> {
		this.writes += 1;
		this.value = structuredClone(value);
	}
}

class MemoryResponseStore implements ResponseCacheStore {
	readonly values = new Map<string, ResponseCacheEntry>();
	async read(id: string): Promise<ResponseCacheEntry | null> {
		return this.values.get(id) ?? null;
	}
	async write(entry: ResponseCacheEntry): Promise<void> {
		this.values.set(entry.id, entry);
	}
	async invalidate(query: ResponseCacheInvalidation): Promise<void> {
		for (const [id, entry] of this.values) {
			if (
				query.all ||
				query.ids?.includes(id) ||
				query.kinds?.includes(entry.kind) ||
				query.tags?.some((tag) => entry.tags.includes(tag))
			) this.values.delete(id);
		}
	}
	async snapshotEntries(): Promise<readonly ResponseCacheEntry[]> {
		return Object.freeze([...this.values.values()]);
	}
}

class MemoryWebDavServer {
	text: string | null = null;
	version = 0;
	failRead = false;
	conflictsRemaining = 0;
	blockNextRead = false;
	cachedRead: ReaderWebDavRequestResponse | null = null;
	readonly requests: ReaderWebDavRequestOptions[] = [];
	#releaseRead: (() => void) | null = null;

	get readBlocked(): boolean {
		return this.#releaseRead !== null;
	}

	releaseRead(): void {
		const release = this.#releaseRead;
		if (!release) throw new Error('当前没有等待释放的 WebDAV 读取');
		this.#releaseRead = null;
		release();
	}

	request = (options: ReaderWebDavRequestOptions): { abort(): void } => {
		this.requests.push(options);
		queueMicrotask(async () => {
			if (options.method === 'MKCOL') {
				options.onload({ status: 405 });
				return;
			}
			if (options.method === 'PROPFIND') {
				options.onload({ status: 207 });
				return;
			}
			if (options.method === 'GET') {
				if (this.blockNextRead) {
					this.blockNextRead = false;
					await new Promise<void>((resolve) => {
						this.#releaseRead = resolve;
					});
				}
				if (this.failRead) {
					options.onload({ status: 503 });
					return;
				}
				const bypassCache = options.headers['Cache-Control'] === 'no-cache' &&
					options.headers.Pragma === 'no-cache';
				if (!bypassCache && this.cachedRead) {
					options.onload(this.cachedRead);
					return;
				}
				this.cachedRead = this.text === null
					? Object.freeze({ status: 404 })
					: Object.freeze({
						status: 200,
						responseText: this.text,
						responseHeaders: `ETag: "v${this.version}"`,
					});
				options.onload(this.cachedRead);
				return;
			}
			if (this.conflictsRemaining > 0) {
				this.conflictsRemaining -= 1;
				this.version += 1;
				options.onload({ status: 412 });
				return;
			}
			const expected = this.text === null
				? options.headers['If-None-Match'] === '*'
				: options.headers['If-Match'] === `"v${this.version}"`;
			if (!expected) {
				options.onload({ status: 412 });
				return;
			}
			this.text = String(options.data ?? '');
			this.version += 1;
			options.onload({
				status: this.version === 1 ? 201 : 204,
				responseHeaders: `ETag: "v${this.version}"`,
			});
		});
		return { abort() {} };
	};
}

function queueRecords(
	ids: readonly number[],
	titleSuffix = '',
): readonly ReaderWebDavLocalRecord[] {
	return Object.freeze(ids.map((topicId) => Object.freeze({
		id: String(topicId),
		value: Object.freeze({
			topicId,
			title: `Topic ${topicId}${titleSuffix}`,
			href: `/t/${topicId}`,
			addedAt: 1_000 + topicId,
			pinned: false,
		}),
	})));
}

function queuePort(state: {
	records: readonly ReaderWebDavLocalRecord[];
	applies: number;
}): ReaderWebDavCategoryPort {
	return Object.freeze({
		category: 'queue',
		initialStrategy: 'merge',
		validateRecord: (id: string, value: unknown) => {
			const source = value as Readonly<{ topicId?: unknown }> | null;
			return String(source?.topicId ?? '') === id;
		},
		capture: () => state.records,
		mergeValues: (local: unknown) => local,
		apply: (records: readonly ReaderWebDavLocalRecord[]) => {
			state.records = Object.freeze([...records]);
			state.applies += 1;
		},
	});
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
		username: 'webdav-account@example.test',
		password: 'webdav-application-password',
		remotePath: 'ALR-Lite/v2/sync.json',
		categories: createReaderWebDavCategorySelection({ queue: true }),
		autoSyncEnabled: false,
		autoSyncIntervalMinutes: 60,
	}));
	return result;
}

const deduplicatedBaselineStorage = new MemoryValueStorage();
const deduplicatedBaselineRepository = new ReaderWebDavConfigRepository({
	storage: deduplicatedBaselineStorage,
	createWriterId: () => 'baseline-dedup-device',
});
await deduplicatedBaselineRepository.load();
await deduplicatedBaselineRepository.saveBaseline('target:dedup', Object.freeze({
	queue: Object.freeze({ '1': 'value:first' }),
}));
const writesAfterFirstBaseline = deduplicatedBaselineStorage.writes;
const firstBaselineSnapshot = deduplicatedBaselineRepository.snapshot;
await deduplicatedBaselineRepository.saveBaseline('target:dedup', Object.freeze({
	queue: Object.freeze({ '1': 'value:first' }),
}));
assert(
	deduplicatedBaselineStorage.writes === writesAfterFirstBaseline &&
	deduplicatedBaselineRepository.snapshot === firstBaselineSnapshot,
	'语义相同的 WebDAV 基线必须跳过 GM 存储写入和变更广播',
);

const server = new MemoryWebDavServer();
const client = new ReaderWebDavClient({ request: server.request });
const stateA = { records: queueRecords([1, 2, 3, 4]), applies: 0 };
const stateB = { records: queueRecords([]), applies: 0 };
const repositoryA = await repository('device-a');
const repositoryB = await repository('device-b');
const retryDelays: number[] = [];
const coordinatorA = new ReaderWebDavCoordinator({
	client,
	repository: repositoryA,
	categories: [queuePort(stateA)],
	hostname: () => 'linux.do',
	username: () => 'reader-account',
	now: (() => {
		let now = 10_000;
		return () => ++now;
	})(),
	retryDelay: async (milliseconds) => {
		retryDelays.push(milliseconds);
	},
});
const coordinatorB = new ReaderWebDavCoordinator({
	client,
	repository: repositoryB,
	categories: [queuePort(stateB)],
	hostname: () => 'linux.do',
	username: () => 'reader-account',
	now: (() => {
		let now = 20_000;
		return () => ++now;
	})(),
});

const upload = await coordinatorA.syncNow();
assert(
	upload.uploaded === 4 && stateA.records.length === 4 && stateA.applies === 0,
	'完整同步链必须把设备 A 的四个队列上传并保留本机',
);
assert(
	server.requests.filter((request) => request.method === 'MKCOL').length === 2 &&
	server.requests.some((request) =>
		request.method === 'PUT' && request.headers['If-None-Match'] === '*'),
	'首次写入必须逐级确保目录并使用 If-None-Match 条件创建',
);
assert(
	!String(server.text).includes('webdav-application-password') &&
	!String(server.text).includes('webdav-account@example.test') &&
	!server.requests.some((request) =>
		request.url.includes('webdav-application-password') ||
		Object.values(request.headers).includes('webdav-application-password')),
	'WebDAV 凭据不得进入远端文档、URL 或显式请求头',
);

const putsAfterCreate = server.requests.filter((request) =>
	request.method === 'PUT').length;
const appliesBeforeRepeat = stateA.applies;
const repeat = await coordinatorA.syncNow();
assert(
	repeat.uploaded === 0 &&
	stateA.applies === appliesBeforeRepeat &&
	server.requests.filter((request) => request.method === 'PUT').length ===
		putsAfterCreate &&
	server.requests.filter((request) => request.method === 'GET').every((request) =>
		request.headers['Cache-Control'] === 'no-cache' &&
		request.headers.Pragma === 'no-cache'),
	'首次创建后立即再次同步必须绕过旧 GET/404 缓存，并在无变化时跳过 PUT',
);

const reconfiguredServer = new MemoryWebDavServer();
const reconfiguredRepository = await repository('reconfigured-device');
const reconfiguredState = { records: queueRecords([88]), applies: 0 };
const reconfiguredCoordinator = new ReaderWebDavCoordinator({
	client: new ReaderWebDavClient({ request: reconfiguredServer.request }),
	repository: reconfiguredRepository,
	categories: [queuePort(reconfiguredState)],
	hostname: () => 'linux.do',
	username: () => 'reader-account',
});
reconfiguredServer.blockNextRead = true;
const oldTargetSync = reconfiguredCoordinator.syncNow();
while (!reconfiguredServer.readBlocked) await Promise.resolve();
await reconfiguredRepository.saveConfig(normalizeReaderWebDavConfig({
	...reconfiguredRepository.snapshot.config,
	remotePath: 'ALR-Lite/v2/reconfigured.json',
}));
assert(
	reconfiguredRepository.snapshot.status.kind === 'idle' &&
	reconfiguredRepository.snapshot.status.message.includes('尚未使用当前配置同步'),
	'连接目标变化时必须清除旧目标同步状态，不能把旧成功或错误展示为当前配置结果',
);
const newTargetSync = reconfiguredCoordinator.syncNow();
reconfiguredServer.releaseRead();
await Promise.all([oldTargetSync, newTargetSync]);
const reconfiguredReads = reconfiguredServer.requests.filter((request) =>
	request.method === 'GET');
assert(
	newTargetSync !== oldTargetSync &&
	reconfiguredReads.length === 2 &&
	reconfiguredReads[0]?.url.endsWith('/ALR-Lite/v2/sync.json') &&
	reconfiguredReads[1]?.url.endsWith('/ALR-Lite/v2/reconfigured.json'),
	'同步进行中修改连接配置后再次同步，必须等待旧事务并按新目标完整执行，不能复用旧目标结果',
);

const identityServer = new MemoryWebDavServer();
identityServer.text = JSON.stringify({
	format: 'awesome-linuxdo-reader-lite-webdav',
	schemaVersion: 2,
	updatedAt: 1,
	writerId: 'remote-device',
	scopes: {
		'site:linux.do|account:reader-account': {
			categories: {
				queue: {
					records: {
						'99': {
							changedAt: 1,
							writerId: 'remote-device',
							deleted: false,
							value: {
								topicId: 100,
								title: '错误绑定的 Topic',
								href: '/t/100',
								addedAt: 1,
								pinned: false,
							},
						},
					},
				},
			},
		},
	},
});
identityServer.version = 1;
const identityState = { records: queueRecords([]), applies: 0 };
const identityCoordinator = new ReaderWebDavCoordinator({
	client: new ReaderWebDavClient({ request: identityServer.request }),
	repository: await repository('identity-device'),
	categories: [queuePort(identityState)],
	hostname: () => 'linux.do',
	username: () => 'reader-account',
});
let identityFailure = '';
try {
	await identityCoordinator.syncNow();
} catch (cause) {
	identityFailure = cause instanceof Error ? cause.message : '';
}
assert(
	identityFailure.includes('身份不一致') &&
	identityState.records.length === 0 &&
	identityState.applies === 0 &&
	!identityServer.requests.some((request) => request.method === 'PUT'),
	'主同步记录键与载荷业务身份不一致时必须在写入和本地应用前拒绝整轮事务',
);

stateA.records = queueRecords([1, 2, 3, 4], ' updated');
server.conflictsRemaining = 2;
const recoveredConflict = await coordinatorA.syncNow();
assert(
	recoveredConflict.uploaded === 4 &&
	retryDelays.join(',') === '250,750',
	`远端版本瞬时变化时必须退避后重新读取并成功写入：uploaded=${
		recoveredConflict.uploaded
	}, delays=${retryDelays.join(',')}`,
);

const download = await coordinatorB.syncNow();
assert(
	download.imported === 4 &&
	stateB.records.map((entry) => entry.id).join(',') === '1,2,3,4',
	'另一个空白浏览器同步后必须实际应用四个阅读队列',
);

const releaseCacheClear = await coordinatorB.acquireLocalCacheClear(['queue']);
stateB.records = Object.freeze([]);
const requestCountDuringCacheClear = server.requests.length;
let cacheClearSyncSettled = false;
const restoreAfterCacheClear = coordinatorB.syncNow().then((result) => {
	cacheClearSyncSettled = true;
	return result;
});
await Promise.resolve();
assert(
	!cacheClearSyncSettled && server.requests.length === requestCountDuringCacheClear,
	'本机缓存清理事务释放前，手动或定时 WebDAV 同步都不得读取半清理状态',
);
releaseCacheClear();
const restoredCache = await restoreAfterCacheClear;
assert(
	restoredCache.imported === 4 &&
	restoredCache.deleted === 0 &&
	stateB.records.map((entry) => entry.id).join(',') === '1,2,3,4',
	'解除同步基线后清空本机缓存，下一次同步必须从远端恢复而不是写入删除墓碑',
);

stateB.records = Object.freeze([]);
const remove = await coordinatorB.syncNow();
assert(
	remove.deleted === 4 && stateB.records.length === 0,
	'有同步基线的浏览器清空队列后必须写入删除墓碑',
);
const receiveRemove = await coordinatorA.syncNow();
assert(
	receiveRemove.imported === 4 && Number(stateA.records.length) === 0,
	'另一浏览器必须应用远端删除，不能复活四个旧队列',
);

const targetIsolationState = {
	records: queueRecords([77]),
	applies: 0,
};
const targetIsolationRepository = await repository('target-isolation-device');
const firstTargetServer = new MemoryWebDavServer();
await new ReaderWebDavCoordinator({
	client: new ReaderWebDavClient({ request: firstTargetServer.request }),
	repository: targetIsolationRepository,
	categories: [queuePort(targetIsolationState)],
	hostname: () => 'linux.do',
	username: () => 'reader-account',
}).syncNow();
await targetIsolationRepository.saveConfig(normalizeReaderWebDavConfig({
	...targetIsolationRepository.snapshot.config,
	endpoint: 'https://dav-second.example.test/dav/',
}));
const secondTargetServer = new MemoryWebDavServer();
const firstSyncToSecondTarget = await new ReaderWebDavCoordinator({
	client: new ReaderWebDavClient({ request: secondTargetServer.request }),
	repository: targetIsolationRepository,
	categories: [queuePort(targetIsolationState)],
	hostname: () => 'linux.do',
	username: () => 'reader-account',
}).syncNow();
assert(
	firstSyncToSecondTarget.uploaded === 1 &&
	firstSyncToSecondTarget.deleted === 0 &&
	targetIsolationState.records[0]?.id === '77' &&
	Object.keys(targetIsolationRepository.snapshot.baselines).length === 2,
	'切换 WebDAV 服务、账号或远端文件后必须使用独立基线，不能把新空目标误判成远端删除',
);
await targetIsolationRepository.forgetBaselineCategories(['queue']);
assert(
	Object.keys(targetIsolationRepository.snapshot.baselines).length === 2 &&
	Object.values(targetIsolationRepository.snapshot.baselines).every(
		(baseline) => baseline.queue === undefined,
	),
	'本机缓存清理必须解除所有历史 WebDAV 目标的对应基线，不能只修当前地址',
);

stateA.records = queueRecords([9]);
const applyCountBeforeFailure = stateA.applies;
server.conflictsRemaining = 3;
let persistentConflictMessage = '';
try {
	await coordinatorA.syncNow();
} catch (cause) {
	persistentConflictMessage = cause instanceof Error ? cause.message : '';
}
assert(
	persistentConflictMessage.includes('远端版本持续变化') &&
	persistentConflictMessage.includes('其他标签页或设备') &&
	stateA.records[0]?.id === '9' &&
	stateA.applies === applyCountBeforeFailure,
	'重试耗尽必须说明可能的并发来源并保留本机数据，不能断言另一设备已更新',
);
server.failRead = true;
let failed = false;
try {
	await coordinatorA.syncNow();
} catch {
	failed = true;
}
assert(
	failed &&
	stateA.records.length === 1 &&
	stateA.records[0]?.id === '9' &&
	stateA.applies === applyCountBeforeFailure,
	'远端读取失败时不得调用本地 apply 或覆盖当前队列',
);
server.failRead = false;

await client.test(
	normalizeReaderWebDavConfig({
		endpoint: 'https://dav.example.test/dav/',
		username: 'u',
		password: 'p',
		remotePath: 'ALR-Lite/v2/sync.json',
		categories: { queue: true },
	}),
	new AbortController().signal,
);
assert(
	server.requests.at(-1)?.method === 'PROPFIND' &&
	server.requests.at(-1)?.headers.Depth === '0',
	'连接测试必须使用只读 Depth 0 PROPFIND，不能靠写临时文件判断',
);

await repositoryA.saveConfig(normalizeReaderWebDavConfig({
	...repositoryA.snapshot.config,
	autoSyncEnabled: true,
	autoSyncIntervalMinutes: 30,
}));
const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
const autoSync = new ReaderWebDavAutoSync({
	repository: repositoryA,
	coordinator: coordinatorA,
	visibilityState: () => 'visible',
	startupDelayMs: 1_200,
	schedule: (callback, delayMs) => {
		scheduled.push({ callback, delayMs });
		return callback;
	},
	cancel: () => {},
});
await Promise.resolve();
assert(
	scheduled[0]?.delayMs === 1_200,
	'启用定时同步后必须先按启动延迟调度，不能启动即抢写远端',
);
scheduled.shift()!.callback();
await new Promise<void>((resolve) => setTimeout(resolve, 0));
await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert(
	scheduled.at(-1)?.delayMs === 30 * 60_000,
	'一次自动同步结束后必须按用户所选间隔继续调度',
);
autoSync.scope.destroy();

async function translationWebDavRepository(
	writerId: string,
	password: string,
	categories: unknown = { translation: true },
): Promise<ReaderWebDavConfigRepository> {
	const result = new ReaderWebDavConfigRepository({
		storage: new MemoryValueStorage(),
		createWriterId: () => writerId,
	});
	await result.load();
	await result.saveConfig(normalizeReaderWebDavConfig({
		endpoint: 'https://dav.example.test/dav/',
		username: 'webdav-account@example.test',
		password,
		remotePath: 'ALR-Lite/v2/sync.json',
		categories: createReaderWebDavCategorySelection(categories),
		autoSyncEnabled: false,
		autoSyncIntervalMinutes: 60,
	}));
	return result;
}

async function translationRepository(
	apiKey = '',
): Promise<ReaderTranslationConfigRepository> {
	const result = new ReaderTranslationConfigRepository({
		storage: new MemoryValueStorage(),
	});
	await result.load();
	if (apiKey) await result.saveConfig(normalizeReaderTranslationConfig({
		baseUrl: 'https://api.example.com/v1/',
		apiKey,
		model: 'translation-model',
		prompt: '使用社区术语，保留占位符。',
		temperature: 0.1,
		reasoningEffort: 'low',
		requestsPerMinute: 120,
		tokensPerMinute: 500_000,
	}));
	return result;
}

const encryptedServer = new MemoryWebDavServer();
const encryptedClient = new ReaderWebDavClient({ request: encryptedServer.request });
const translationA = await translationRepository('sk-encrypted-remote-test');
const translationB = await translationRepository();
const primaryTranslationProfile = readerTranslationActiveProfile(
	translationA.snapshot.config,
);
await translationA.saveConfig(normalizeReaderTranslationConfig({
	activeBaseUrl: primaryTranslationProfile.baseUrl,
	animation: 'fade',
	profiles: [
		primaryTranslationProfile,
		{
			...primaryTranslationProfile,
			baseUrl: 'https://second.example.com/v1/',
			apiKey: 'sk-second-encrypted-test',
			model: 'second-translation-model',
			animation: 'blur',
		},
	],
}));
const translationRepositoryA = await translationWebDavRepository(
	'translation-device-a',
	'shared-webdav-password',
);
const translationRepositoryB = await translationWebDavRepository(
	'translation-device-b',
	'shared-webdav-password',
);
const translationCoordinatorA = new ReaderWebDavCoordinator({
	client: encryptedClient,
	repository: translationRepositoryA,
	categories: [createReaderWebDavTranslationCategoryPort(translationA)],
	hostname: () => 'linux.do',
	username: () => 'reader-account',
});
const translationCoordinatorB = new ReaderWebDavCoordinator({
	client: encryptedClient,
	repository: translationRepositoryB,
	categories: [createReaderWebDavTranslationCategoryPort(translationB)],
	hostname: () => 'linux.do',
	username: () => 'reader-account',
});
const encryptedUpload = await translationCoordinatorA.syncNow();
assert(
	encryptedUpload.uploaded === 1 &&
	!String(encryptedServer.text).includes('sk-encrypted-remote-test') &&
	!String(encryptedServer.text).includes('sk-second-encrypted-test') &&
	String(encryptedServer.text).includes('translation-model') &&
	String(encryptedServer.text).includes('"requestsPerMinute":120') &&
	String(encryptedServer.text).includes('"tokensPerMinute":500000') &&
	String(encryptedServer.text).includes('https://api.example.com/v1/') &&
	String(encryptedServer.text).includes('https://second.example.com/v1/') &&
	String(encryptedServer.text).includes('AES-256-GCM'),
	'AI 翻译服务集合必须明文同步 URL 与参数，但每个 URL 对应的 API Key 只能出现标准密文封装',
);
const encryptedDownload = await translationCoordinatorB.syncNow();
const downloadedProfile = readerTranslationActiveProfile(
	translationB.snapshot.config,
);
assert(
	encryptedDownload.imported === 1 &&
	translationB.snapshot.config.profiles.length === 2 &&
	downloadedProfile.apiKey === 'sk-encrypted-remote-test' &&
	downloadedProfile.model === 'translation-model' &&
	downloadedProfile.reasoningEffort === 'low' &&
	downloadedProfile.requestsPerMinute === 120 &&
	downloadedProfile.tokensPerMinute === 500_000 &&
	translationB.snapshot.config.animation === 'fade' &&
	translationB.snapshot.config.profiles.every((profile) =>
		profile.animation === 'fade') &&
	translationB.snapshot.config.profiles.some((profile) =>
		profile.baseUrl === 'https://second.example.com/v1/' &&
		profile.apiKey === 'sk-second-encrypted-test'),
	'使用相同 WebDAV 应用密码的另一设备必须解密并应用完整 AI 翻译设置，动画作为全局偏好保持一致',
);

const translationCachePolicy = Object.freeze({
	kind: 'translations',
	tags: Object.freeze(['translation:zh-CN']),
	freshForMs: 30 * 24 * 60 * 60_000,
	retainForMs: 180 * 24 * 60 * 60_000,
	persist: true,
});
const cacheEntryId = 'reader-translation-section?' +
	'provider=ai-section-v1&sourceLanguage=auto&targetLanguage=zh-CN&' +
	'textFingerprint=sha256%3Asection-webdav';
const cacheA = new ResponseRepository({
	store: new MemoryResponseStore(),
	maxMemoryEntries: 32,
	maxMemoryBytes: 1_000_000,
	now: () => 30_000,
});
const cacheB = new ResponseRepository({
	store: new MemoryResponseStore(),
	maxMemoryEntries: 32,
	maxMemoryBytes: 1_000_000,
	now: () => 40_000,
});
await cacheA.write({ id: cacheEntryId, ...translationCachePolicy }, '跨设备复用的译文');
const cacheServer = new MemoryWebDavServer();
const cacheClient = new ReaderWebDavClient({ request: cacheServer.request });
const cacheCoordinatorA = new ReaderWebDavCoordinator({
	client: cacheClient,
	repository: await translationWebDavRepository(
		'translation-cache-device-a',
		'shared-webdav-password',
		{ 'translation-cache': true },
	),
	categories: [createReaderWebDavTranslationCacheCategoryPort({
		responses: cacheA,
		cache: translationCachePolicy,
	})],
	hostname: () => 'linux.do',
	username: () => 'reader-account',
});
const cacheCoordinatorB = new ReaderWebDavCoordinator({
	client: cacheClient,
	repository: await translationWebDavRepository(
		'translation-cache-device-b',
		'shared-webdav-password',
		{ 'translation-cache': true },
	),
	categories: [createReaderWebDavTranslationCacheCategoryPort({
		responses: cacheB,
		cache: translationCachePolicy,
	})],
	hostname: () => 'linux.do',
	username: () => 'reader-account',
});
await cacheCoordinatorA.syncNow();
assert(
	!String(cacheServer.text).includes('AES-256-GCM') &&
	String(cacheServer.text).includes('跨设备复用的译文') &&
	String(cacheServer.text).includes(cacheEntryId),
	'已翻译 Section 必须作为独立普通 WebDAV 分类上传，只有翻译 URL 对应的 Key 才允许加密',
);
const cacheDownload = await cacheCoordinatorB.syncNow();
const importedTranslation = await cacheB.read<string>({
	id: cacheEntryId,
	...translationCachePolicy,
});
assert(
	cacheDownload.imported === 1 &&
	importedTranslation.value === '跨设备复用的译文',
	'另一设备同步后必须把已翻译 Section 写回中央 ResponseRepository 并直接命中',
);

const translationWrongPassword = await translationRepository('local-key-preserved');
const wrongPasswordCoordinator = new ReaderWebDavCoordinator({
	client: encryptedClient,
	repository: await translationWebDavRepository(
		'translation-device-c',
		'wrong-webdav-password',
	),
	categories: [createReaderWebDavTranslationCategoryPort(
		translationWrongPassword,
	)],
	hostname: () => 'linux.do',
	username: () => 'reader-account',
});
let decryptionFailed = false;
try {
	await wrongPasswordCoordinator.syncNow();
} catch {
	decryptionFailed = true;
}
assert(
	decryptionFailed &&
	readerTranslationActiveProfile(translationWrongPassword.snapshot.config).apiKey ===
		'local-key-preserved',
	'应用密码不匹配时必须拒绝同步并保留本机翻译密钥，不能覆盖或降级成明文',
);
