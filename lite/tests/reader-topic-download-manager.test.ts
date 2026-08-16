import { parseHTML } from 'linkedom';
import { discourseTopicId } from '../src/discourse/identifiers.js';
import type {
	ReaderTopicOfflineArtifactRecord,
} from '../src/archive/reader-topic-offline-artifact-repository.js';
import {
	parseReaderTopicDownloadPostSelection,
	readerTopicDownloadCoverage,
	readerTopicDownloadLocalArchivePlan,
	READER_TOPIC_DOWNLOAD_WINDOW_GEOMETRY_STORAGE_KEY,
	ReaderTopicDownloadManager,
	selectReaderTopicDownloadPosts,
	type ReaderTopicDownloadArtifact,
	type ReaderTopicDownloadRemovalChoice,
	type ReaderTopicDownloadRemovalContext,
	type ReaderTopicDownloadSelection,
} from '../src/queue/reader-topic-download-manager.js';
import {
	READER_COLLECTION_FLOATING_WINDOW_GEOMETRY_KEY,
} from '../src/collection/reader-collection-floating-window.js';
import {
	RequestCloudflareChallengeError,
	RequestRateLimitError,
} from '../src/network/coordinated-request-client.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function deferred(): {
	readonly promise: Promise<void>;
	readonly resolve: () => void;
} {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
assert(
	parseReaderTopicDownloadPostSelection('1,3,8-10,9,12').join(',') ===
		'1,3,8,9,10,12',
	'自定义楼层必须支持英文逗号列表、n-m 范围、去重和排序',
);
for (const invalidExpression of [
	'3-1',
	'0',
	'1,,3',
	'1--3',
	'1，3',
	'1, 3',
]) {
	let rejected = false;
	try {
		parseReaderTopicDownloadPostSelection(invalidExpression);
	} catch {
		rejected = true;
	}
	assert(rejected, `非法自定义楼层必须阻止下载：${invalidExpression}`);
}
const incompleteReplyCoverage = readerTopicDownloadCoverage({
	selectionMode: 'all',
	streamComplete: true,
	missingCanonicalPostCount: 0,
	repliesComplete: false,
	archived: false,
});
assert(
	!incompleteReplyCoverage.complete &&
		incompleteReplyCoverage.warning.includes('部分回复关系无法确认'),
	'canonical 正文缺失为 0 时，讨论关系不完整必须降级导出而不是误报下载失败',
);
let missingCanonicalRejected = false;
try {
	readerTopicDownloadCoverage({
		selectionMode: 'custom',
		streamComplete: false,
		missingCanonicalPostCount: 2,
		repliesComplete: false,
		archived: false,
	});
} catch (error) {
	missingCanonicalRejected = String(error).includes('缺少 2 个 canonical 楼层');
}
assert(
	missingCanonicalRejected,
	'真实缺少 canonical 正文且没有本地存档时仍必须阻止生成伪完整下载',
);
const archivedCoverage = readerTopicDownloadCoverage({
	selectionMode: 'all',
	streamComplete: false,
	missingCanonicalPostCount: 2,
	repliesComplete: false,
	archived: true,
});
assert(
	!archivedCoverage.complete &&
		archivedCoverage.warning.includes('仅保留当前可用正文') &&
		archivedCoverage.warning.includes('部分回复关系无法确认'),
	'Topic 或楼层已 404/410 时必须允许把现有本地正文降级下载，并明确标记缺失',
);
const localArchivePlan = readerTopicDownloadLocalArchivePlan({
	topicStatus: 404,
	cachedPostCount: 6,
	expectedPostCount: 10,
	streamPostCount: 8,
	missingStreamPostCount: 2,
	streamComplete: false,
});
assert(
	localArchivePlan?.completed === 6 &&
		localArchivePlan.total === 10 &&
		localArchivePlan.missingCanonicalPostCount === 4 &&
		localArchivePlan.streamComplete === false &&
		readerTopicDownloadLocalArchivePlan({
			topicStatus: null,
			cachedPostCount: 6,
			expectedPostCount: 10,
			streamPostCount: 8,
			missingStreamPostCount: 2,
			streamComplete: false,
		}) === null,
	'Topic 404 且有正文缓存时必须切换纯本地下载，并按预期楼层标明缺失；在线 Topic 不得误降级',
);
const selectablePosts = Object.freeze([
	Object.freeze({ post_number: 1, username: 'owner' }),
	Object.freeze({ post_number: 2, username: 'member' }),
	Object.freeze({ post_number: 3, username: 'owner' }),
	Object.freeze({ post_number: 8, username: 'member' }),
]);
const opSelection = Object.freeze({
	mode: 'op' as const,
	expression: '',
	postNumbers: Object.freeze([]),
});
const opProjection = selectReaderTopicDownloadPosts(
	selectablePosts,
	opSelection,
);
const archivedOpProjection = selectReaderTopicDownloadPosts(
	selectablePosts.filter((post) => post.post_number !== 1),
	opSelection,
	'owner',
);
const customProjection = selectReaderTopicDownloadPosts(selectablePosts, {
		mode: 'custom',
		expression: '2,8',
		postNumbers: Object.freeze([2, 8]),
});
assert(
	opProjection.posts.length === selectablePosts.length &&
		opProjection.mainPostNumbers?.join(',') === '1,3' &&
		archivedOpProjection.mainPostNumbers?.join(',') === '3' &&
		customProjection.posts.length === selectablePosts.length &&
		customProjection.mainPostNumbers?.join(',') === '2,8',
	'楼主与自定义楼层必须只改变主流锚点，且缺失首楼时仍复用 Topic 楼主身份',
);
const artifact = (topicId: number): ReaderTopicDownloadArtifact => Object.freeze({
	html: `<!doctype html><title>Topic ${topicId}</title>`,
	filename: `topic-${topicId}.html`,
	postCount: 3,
	expectedPostCount: 3,
	complete: true,
	archiveStatus: topicId === 41 ? 404 : null,
});

const { document: parsedDocument, window: parsedWindowSource } = parseHTML(
	'<!doctype html><html><body><main id="mount">' +
		'<button id="download-history"></button><button id="outside"></button>' +
	'</main></body></html>',
);
const document = parsedDocument as unknown as Document;
const parsedWindow = parsedWindowSource;
Object.defineProperty(parsedWindow, 'innerWidth', {
	configurable: true,
	value: 1_200,
});
Object.defineProperty(parsedWindow, 'innerHeight', {
	configurable: true,
	value: 800,
});
const mount = document.querySelector<HTMLElement>('#mount')!;
const firstGate = deferred();
const staleCancelGate = deferred();
const retryGate = deferred();
const rateLimitResumeGate = deferred();
const challengeResumeGate = deferred();
const rateLimitWaits: number[] = [];
const saved: string[] = [];
const viewed: string[] = [];
const viewedTopicIds: number[] = [];
const notices: string[] = [];
const attempts = new Map<number, number>();
const workerSelections: ReaderTopicDownloadSelection[] = [];
const backups = new Map<number, ReaderTopicOfflineArtifactRecord>();
const hiddenBackups = new Set<number>();
const removalRequests: ReaderTopicDownloadRemovalContext[] = [];
const removalChoices: ReaderTopicDownloadRemovalChoice[] = [];
const removalHosts: HTMLElement[] = [];
const bulkRemovalRequests: Array<readonly ReaderTopicDownloadRemovalContext[]> = [];
const bulkRemovalHosts: HTMLElement[] = [];
const geometryValues = new Map<string, string>();
const geometryStorage = {
	getItem: (key: string) => geometryValues.get(key) ?? null,
	setItem: (key: string, value: string) => {
		geometryValues.set(key, value);
	},
};
let settleBulkRemoval: ((choice: ReaderTopicDownloadRemovalChoice) => void) | null =
	null;
const artifactStore = {
	list: async () => Object.freeze([...backups.values()]
		.filter((record) => !hiddenBackups.has(record.topicId))
		.map((record) => {
			const { html: _html, ...entry } = record;
			return Object.freeze(entry);
		})),
	read: async (topicId: number) => backups.get(topicId) ?? null,
	write: async (record: ReaderTopicOfflineArtifactRecord) => {
		hiddenBackups.delete(record.topicId);
		backups.set(record.topicId, record);
	},
	remove: async (
		topicId: number,
		options: Readonly<{ readonly preserveHtml?: boolean }> = {},
	) => {
		if (options.preserveHtml === true) hiddenBackups.add(topicId);
		else {
			hiddenBackups.delete(topicId);
			backups.delete(topicId);
		}
	},
};
let cancelledSignal: AbortSignal | null = null;
let cancellationObserved = false;
let retryStarted = false;
const manager = new ReaderTopicDownloadManager({
	document,
	mount,
	floating: true,
	geometryStorage,
	currentTopic: () => Object.freeze({
		topicId: discourseTopicId(41),
		title: '当前 Topic',
	}),
	worker: async (topicId, _title, signal, report, selection) => {
		workerSelections.push(selection);
		const attempt = (attempts.get(topicId) ?? 0) + 1;
		attempts.set(topicId, attempt);
		if (topicId === 41) {
			report({
				phase: 'loading-posts',
				completed: 1,
				total: 3,
				detail: '正在下载正文 1/3',
			});
			await firstGate.promise;
		}
		if (topicId === 42 && attempt === 1) throw new Error('temporary');
		if (topicId === 43) {
			cancelledSignal = signal;
			await new Promise<void>((_resolve, reject) => {
				signal.addEventListener('abort', () => {
					cancellationObserved = true;
					reject(signal.reason);
				}, { once: true });
			});
		}
		if (topicId === 44) {
			if (attempt === 1) {
				await staleCancelGate.promise;
				signal.throwIfAborted();
			} else {
				retryStarted = true;
				await retryGate.promise;
			}
		}
		if (topicId === 45 && attempt === 1) {
			report({
				phase: 'loading-posts',
				completed: 2,
				total: 5,
				detail: '正在下载正文 2/5',
			});
			throw new RequestRateLimitError(Object.freeze({
				scope: 'endpoint',
				waitMs: 2_500,
				retryAt: 3_500,
				fingerprint: 'GET:https://linux.do/t/45/posts.json',
				route: 'GET:https://linux.do/t/:id/posts.json',
				window: 'unknown',
			}));
		}
		if (topicId === 46 && attempt === 1) {
			report({
				phase: 'loading-posts',
				completed: 3,
				total: 8,
				detail: '正在下载正文 3/8',
			});
			throw new RequestCloudflareChallengeError(
				429,
				'https://linux.do/t/46/posts.json',
			);
		}
		if (topicId === 47) {
			report({
				phase: 'loading-replies',
				completed: attempt,
				total: 20,
				detail: `正在补齐讨论正文 ${attempt}/20`,
			});
				throw new RequestRateLimitError(Object.freeze({
				scope: 'endpoint',
				waitMs: 2_500,
				retryAt: 3_500,
				fingerprint: 'GET:https://linux.do/posts/47/replies.json',
				route: 'GET:https://linux.do/posts/:id/replies.json',
				window: 'unknown',
			}));
		}
		if (topicId === 48) {
			report({
				phase: 'loading-replies',
				completed: attempt,
				total: 20,
				detail: `正在补齐讨论正文 ${attempt}/20`,
			});
			throw new RequestCloudflareChallengeError(
				429,
				'https://linux.do/posts/48/replies.json',
			);
		}
		return artifact(topicId);
	},
	downloads: {
		save: async (_blob, filename) => {
			saved.push(filename);
		},
	},
	artifacts: artifactStore,
	confirmRemoval: async (context, host) => {
		removalRequests.push(context);
		removalHosts.push(host);
		return removalChoices.shift() ?? 'cancel';
	},
	confirmBulkRemoval: async (contexts, host) => {
		bulkRemovalRequests.push(contexts);
		bulkRemovalHosts.push(host);
		return new Promise<ReaderTopicDownloadRemovalChoice>((resolve) => {
			settleBulkRemoval = resolve;
		});
	},
	viewHtml: (_html, title, topicId) => {
		viewed.push(title);
		viewedTopicIds.push(Number(topicId));
	},
	notify: (message) => notices.push(message),
	requestResume: (error) => {
		if (error instanceof RequestRateLimitError) {
			return Object.freeze({
				kind: 'rate-limit' as const,
				decision: error.decision,
				waitMs: error.decision.waitMs,
				wait: async (signal: AbortSignal) => {
					rateLimitWaits.push(error.decision.waitMs);
					await rateLimitResumeGate.promise;
					signal.throwIfAborted();
				},
			});
		}
		if (!(error instanceof RequestCloudflareChallengeError)) return null;
		return Object.freeze({
			kind: 'cloudflare-challenge' as const,
			waitMs: 0 as const,
			wait: async (signal: AbortSignal) => {
				await challengeResumeGate.promise;
				signal.throwIfAborted();
			},
		});
	},
	requestFrame: (callback) => {
		callback(0);
		return 0;
	},
	cancelFrame: () => {},
});

const details = mount.querySelector<HTMLElement>(
	'.ldp-topic-download-manager',
)!;
const floatingWindow = manager.element;
Object.defineProperty(mount, 'getBoundingClientRect', {
	configurable: true,
	value: () => ({
		left: 100, top: 50, right: 900, bottom: 650,
		width: 800, height: 600,
	}),
});
Object.defineProperty(details, 'getBoundingClientRect', {
	configurable: true,
	value: () => ({
		left: 0, top: 0, right: 340, bottom: 300,
		width: 340, height: 300,
	}),
});
assert(
	details.hidden && floatingWindow.hidden &&
		!details.classList.contains('is-open'),
	'Topic 下载管理默认必须隐藏，只由收纳箱中的历史入口打开',
);
assert(
	details.querySelector('.ldp-topic-download-preview:not([hidden]) strong')
		?.textContent === '当前 Topic' &&
		details.querySelector('.ldp-topic-download-preview')?.textContent
			?.includes('Topic #41 · 全部楼层') === true &&
		details.querySelector('.ldp-topic-download-active-task') === null,
	'创建任务前必须显示当前 Topic 与下载范围，且不得预建重复进度组件',
);
assert(
	floatingWindow.querySelector('.ldp-reader-floating-window-title')
		?.textContent === '主题下载' &&
	floatingWindow.querySelector('.ldp-reader-floating-window-pin') !== null &&
	details.querySelector('.ldp-topic-download-summary') === null &&
		details.querySelector('.ldp-topic-download-toolbar')?.children.length === 1 &&
		details.querySelector('.ldp-topic-download-selection > label')
			?.firstElementChild?.textContent === '下载范围' &&
		details.querySelector('.ldp-topic-download-current')?.parentElement
			?.classList.contains('ldp-topic-download-selection') === true,
	'下载必须复用共享浮窗标题栏，下载范围作为下拉上方 label，开始下载并入同一卡片',
);
assert(
	READER_TOPIC_DOWNLOAD_WINDOW_GEOMETRY_STORAGE_KEY ===
		READER_COLLECTION_FLOATING_WINDOW_GEOMETRY_KEY &&
	manager.openManager() && !details.hidden && !floatingWindow.hidden &&
		details.classList.contains('is-open') &&
		floatingWindow.style.left === '320px' &&
		floatingWindow.style.top === '60px' &&
		floatingWindow.style.width === '560px' &&
		floatingWindow.style.height === '680px' &&
		floatingWindow.parentElement?.classList.contains(
			'ldp-reader-floating-host',
		) === true &&
		floatingWindow.querySelectorAll(
			'.ldp-reader-floating-window-resize',
		).length === 8,
	'下载历史必须复用用户观察的共享尺寸、居中位置、host 与八向缩放骨架',
);
let floatingWheelLeaks = 0;
mount.addEventListener('wheel', () => {
	floatingWheelLeaks += 1;
});
const floatingBoundaryWheel = new parsedWindow.Event('wheel', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperties(floatingBoundaryWheel, {
	deltaX: { value: 0 },
	deltaY: { value: 120 },
	deltaMode: { value: 0 },
});
floatingWindow.querySelector('.ldp-reader-floating-window-head')!
	.dispatchEvent(floatingBoundaryWheel);
assert(
	floatingBoundaryWheel.defaultPrevented && floatingWheelLeaks === 0,
	'下载管理浮窗的非滚动区不得继续驱动宿主阅读流',
);
const pointerEvent = (type: string, x: number, y: number): Event => {
	const event = new parsedWindow.Event(type, {
		bubbles: true,
		cancelable: true,
	});
	Object.defineProperties(event, {
		button: { value: 0 },
		pointerId: { value: 7 },
		clientX: { value: x },
		clientY: { value: y },
	});
	return event;
};
const downloadSummary = floatingWindow.querySelector<HTMLElement>(
	'.ldp-reader-floating-window-head',
)!;
downloadSummary.dispatchEvent(pointerEvent('pointerdown', 300, 220));
floatingWindow.dispatchEvent(pointerEvent('pointermove', 350, 170));
floatingWindow.dispatchEvent(pointerEvent('pointerup', 350, 170));
assert(
	manager.windowGeometry?.snapshot.geometry.left === 370 &&
		manager.windowGeometry.snapshot.geometry.top === 10 &&
		geometryValues.get(READER_COLLECTION_FLOATING_WINDOW_GEOMETRY_KEY)
			?.includes('"readerWindowX":370') === true &&
		geometryValues.get(READER_COLLECTION_FLOATING_WINDOW_GEOMETRY_KEY)
			?.includes('"readerWindowY":10') === true,
	'拖动下载历史窗口必须把几何立即写入四集合共用存储键',
);
details.dispatchEvent(new parsedWindow.Event('pointerdown', { bubbles: true }));
assert(!details.hidden, '操作下载浮窗内部控件不得触发点外关闭');
floatingWindow.querySelector<HTMLButtonElement>(
	'.ldp-reader-floating-window-pin',
)!.click();
document.querySelector<HTMLElement>('#outside')!.dispatchEvent(
	new parsedWindow.Event('pointerdown', { bubbles: true }),
);
assert(
	!details.hidden && manager.windowGeometry?.snapshot.pinned === true,
	'共享浮窗锁定置顶后，点击窗口外必须保持下载管理可见',
);
floatingWindow.querySelector<HTMLButtonElement>(
	'.ldp-reader-floating-window-pin',
)!.click();
document.querySelector<HTMLElement>('#outside')!.dispatchEvent(
	new parsedWindow.Event('pointerdown', { bubbles: true }),
);
assert(
	!details.hidden && floatingWindow.hidden &&
		details.classList.contains('is-open'),
	'点击下载浮窗外空白必须只收起整组，并保留下载标签会话',
);
manager.openManager();
let underlyingEscapeCount = 0;
document.addEventListener('keydown', () => {
	underlyingEscapeCount += 1;
}, { once: true });
const escape = new parsedWindow.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(escape, 'key', { value: 'Escape' });
document.dispatchEvent(escape);
assert(
	!details.hidden && floatingWindow.hidden &&
		details.classList.contains('is-open') &&
		underlyingEscapeCount === 0,
	'Esc 必须优先收起下载管理整组、保留标签会话并阻止底层 Reader 响应',
);
manager.openManager();
mount.querySelector<HTMLButtonElement>('.ldp-topic-download-current')!.click();
await tick();
assert(
	details.classList.contains('is-open') &&
		manager.snapshot().tasks[0]?.phase === 'loading-posts' &&
		manager.snapshot().tasks[0]?.completed === 1 &&
		manager.snapshot().tasks[0]?.total === 3 &&
		mount.querySelector<HTMLButtonElement>(
			'.ldp-topic-download-current',
		)?.disabled === true &&
		mount.querySelector('.ldp-topic-download-current')?.textContent
			?.includes('正在后台下载') === true &&
		mount.querySelector('.ldp-topic-download-preview:not([hidden])') === null &&
		mount.querySelector<HTMLProgressElement>(
			'.ldp-topic-download-task[data-topic-id="41"] progress',
		)?.value === 1 &&
		mount.querySelector(
			'.ldp-topic-download-task[data-topic-id="41"] small',
		)?.textContent?.includes('33%') === true &&
		notices.some((notice) => notice === '已加入后台下载：当前 Topic'),
	'点击下载后必须隐藏预提交摘要，并由历史任务行持续显示阶段、百分比和确定进度',
);
mount.querySelector<HTMLButtonElement>(
	'.ldp-reader-floating-window-close',
)!.click();
assert(
	details.hidden && floatingWindow.hidden &&
		!details.classList.contains('is-open') &&
		manager.snapshot().tasks[0]?.phase === 'loading-posts',
	'关闭下载管理浮窗必须真正隐藏窗口，但不得取消正在进行的后台任务',
);
manager.openManager();
firstGate.resolve();
await tick();
await tick();
assert(
	manager.snapshot().tasks[0]?.phase === 'ready' &&
		manager.snapshot().tasks[0]?.archiveStatus === 404 &&
		workerSelections[0]?.mode === 'all' &&
		saved.length === 0 &&
		backups.get(41)?.html.includes('<title>Topic 41</title>') === true &&
		backups.get(41)?.archiveStatus === 404 &&
		mount.querySelector<HTMLElement>(
			'.ldp-topic-download-task[data-topic-id="41"]',
		)?.dataset.archiveStatus === '404' &&
		mount.querySelector(
			'.ldp-topic-download-task[data-topic-id="41"] small',
		)?.textContent?.includes('404 版本') === true &&
		mount.querySelector('[data-topic-download-action="view"]') !== null &&
		mount.querySelector('[data-topic-download-action="save"]')
			?.getAttribute('aria-label') === '下载 HTML 到本地',
	'异步完成后只能写入 Reader 下载历史，不得弹浏览器保存框；记录保留查看和手动下载入口',
);
manager.syncCurrent();
const completedAttemptCount = attempts.get(41);
const regenerateButton = mount.querySelector<HTMLButtonElement>(
	'.ldp-topic-download-current',
)!;
assert(
	regenerateButton.disabled === false &&
		regenerateButton.textContent?.includes('重新生成离线 HTML') === true &&
		regenerateButton.getAttribute('aria-label')
			?.includes('重新生成 当前 Topic') === true,
	'同范围历史不得把旧自包含 HTML 冒充当前版本，必须提供明确的重新生成入口',
);
regenerateButton.click();
await tick();
await tick();
assert(
	manager.snapshot().tasks[0]?.phase === 'ready' &&
		attempts.get(41) === Number(completedAttemptCount) + 1 &&
		mount.querySelector('.ldp-topic-download-preview:not([hidden])') === null &&
		mount.querySelector<HTMLButtonElement>(
			'.ldp-topic-download-current',
		)?.disabled === false &&
		mount.querySelector('.ldp-topic-download-current')?.textContent
			?.includes('重新生成离线 HTML') === true,
	'重新生成必须复用相同下载范围并以当前运行时覆盖旧历史，完成后仍保留再次刷新入口',
);
manager.closeManager();
assert(
	manager.prepareCurrentDownload() &&
		!details.hidden && details.classList.contains('is-open') &&
		mount.querySelector<HTMLButtonElement>(
			'.ldp-topic-download-current',
		)?.disabled === false,
	'快捷下载入口必须打开下载管理器，并允许已在历史的同范围离线 HTML 重新生成',
);
mount.querySelector<HTMLButtonElement>(
	'[data-topic-download-action="view"][data-topic-id="41"]',
)!.click();
mount.querySelector<HTMLButtonElement>(
	'[data-topic-download-action="save"][data-topic-id="41"]',
)!.click();
await tick();
assert(
	viewed.join(',') === '当前 Topic' &&
		viewedTopicIds.join(',') === '41' &&
		saved.filter((filename) => filename === 'topic-41.html').length === 1 &&
		Number(backups.get(41)?.localDownloadRequestedAt) > 0,
	'已完成任务必须支持直接查看，并只在用户点击下载按钮后保存到本地',
);

manager.enqueue(42, '重试 Topic');
await tick();
assert(
	manager.snapshot().tasks.find((task) => task.topicId === 42)?.phase === 'error' &&
		mount.querySelector('[data-topic-download-action="retry"][data-topic-id="42"]') !== null,
	'下载失败必须保留错误记录和重试入口',
);
mount.querySelector<HTMLButtonElement>(
	'[data-topic-download-action="retry"][data-topic-id="42"]',
)!.click();
await tick();
await tick();
assert(
	attempts.get(42) === 2 &&
		manager.snapshot().tasks.find((task) => task.topicId === 42)?.phase === 'ready',
	'重试必须重新排入后台队列并在成功后回到 ready',
);
mount.querySelector<HTMLButtonElement>(
	'[data-topic-download-action="save"][data-topic-id="42"]',
)!.click();
await tick();
removalChoices.push('cancel');
mount.querySelector<HTMLButtonElement>(
	'[data-topic-download-action="remove"][data-topic-id="42"]',
)!.click();
await tick();
await tick();
assert(
	manager.snapshot().tasks.some((task) => task.topicId === 42) &&
		removalRequests.at(-1)?.hasCachedHtml === true &&
		Number(removalRequests.at(-1)?.localDownloadRequestedAt) > 0 &&
		removalHosts.at(-1) === details,
	'移除前必须在历史浮窗内部二次确认，并报告 Reader 缓存与曾触发的本地下载状态',
);
removalChoices.push('remove-record');
mount.querySelector<HTMLButtonElement>(
	'[data-topic-download-action="remove"][data-topic-id="42"]',
)!.click();
await tick();
await tick();
assert(
	!manager.snapshot().tasks.some((task) => task.topicId === 42) &&
		backups.has(42) && hiddenBackups.has(42) &&
		!details.hidden && details.classList.contains('is-open'),
	'选择仅移除记录时必须保留 Reader 缓存 HTML，并让下载历史浮窗保持打开',
);

manager.enqueue(43, '取消 Topic');
await tick();
mount.querySelector<HTMLButtonElement>(
	'[data-topic-download-action="cancel"][data-topic-id="43"]',
)!.click();
await tick();
assert(
	cancelledSignal !== null &&
		cancellationObserved &&
		manager.snapshot().tasks.find((task) => task.topicId === 43)?.phase === 'cancelled',
	'后台任务必须可取消，并立即在管理浮窗显示已取消状态',
);
mount.querySelector<HTMLButtonElement>('.ldp-topic-download-batch-toggle')!.click();
const cancelledSelection = mount.querySelector<HTMLInputElement>(
	'[data-topic-download-select][data-topic-id="43"]',
)!;
cancelledSelection.checked = true;
cancelledSelection.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
mount.querySelector<HTMLButtonElement>(
	'.ldp-topic-download-remove-selected',
)!.click();
await tick();
document.querySelector<HTMLElement>('#outside')!.dispatchEvent(
	new parsedWindow.Event('pointerdown', { bubbles: true }),
);
assert(
	bulkRemovalRequests.at(-1)?.map((context) => context.topicId).join(',') === '43' &&
		bulkRemovalHosts.at(-1) === details &&
		!details.hidden && details.classList.contains('is-open'),
	'批量移除必须在历史窗内一次确认全部已选记录，确认期间点外也不得关闭历史浮窗',
);
const finishBulkRemoval = settleBulkRemoval as
	| ((choice: ReaderTopicDownloadRemovalChoice) => void)
	| null;
assert(finishBulkRemoval, '批量移除确认必须暴露待处理事务');
finishBulkRemoval('remove-record-and-cache');
await tick();
await tick();
assert(
	!manager.snapshot().tasks.some((task) => task.topicId === 43) &&
		mount.querySelector('.ldp-topic-download-batch-bar')?.hasAttribute('hidden') ===
			false,
	'批量确认后必须移除已选记录、清空其选择并继续停留在批量管理视图',
);

manager.enqueue(44, '取消后立即重试 Topic');
await tick();
mount.querySelector<HTMLButtonElement>(
	'[data-topic-download-action="cancel"][data-topic-id="44"]',
)!.click();
mount.querySelector<HTMLButtonElement>(
	'[data-topic-download-action="retry"][data-topic-id="44"]',
)!.click();
staleCancelGate.resolve();
await tick();
assert(
	retryStarted &&
		attempts.get(44) === 2 &&
		manager.snapshot().tasks.find((task) => task.topicId === 44)?.phase ===
			'queued' &&
		mount.querySelector(
			'[data-topic-download-action="cancel"][data-topic-id="44"]',
		) !== null &&
		mount.querySelector(
			'[data-topic-download-action="retry"][data-topic-id="44"]',
		) === null,
	'旧下载取消收尾不得覆盖已经开始的新一轮重试状态或再次暴露重试入口',
);
retryGate.resolve();
await tick();
await tick();
assert(
	manager.snapshot().tasks.find((task) => task.topicId === 44)?.phase === 'ready',
	'取消后的单次重试必须正常完成',
);
removalChoices.push('remove-record-and-cache');
mount.querySelector<HTMLButtonElement>(
	'[data-topic-download-action="remove"][data-topic-id="44"]',
)!.click();
await tick();
await tick();
assert(
	!manager.snapshot().tasks.some((task) => task.topicId === 44) &&
		!backups.has(44),
	'选择删除记录和缓存时必须同步清理 Reader 永久 HTML 备份',
);

manager.enqueue(45, '429 断点续传 Topic');
await tick();
await tick();
const rateLimitedTask = manager.snapshot().tasks.find((task) =>
	task.topicId === 45);
assert(
	rateLimitedTask?.phase === 'waiting-rate-limit' &&
		rateLimitedTask.completed === 2 &&
		rateLimitedTask.total === 5 &&
		rateLimitedTask.detail.includes('已保存 2/5 楼断点') &&
		rateLimitWaits.join(',') === '2500' &&
		mount.querySelector<HTMLProgressElement>(
			'.ldp-topic-download-task[data-topic-id="45"] progress',
		)?.value === 2 &&
		mount.querySelector(
			'[data-topic-download-action="cancel"][data-topic-id="45"]',
		) !== null,
	'HTTP 429 必须保留已取得楼层、显示等待进度，并按服务器等待时间自动续传',
);
rateLimitResumeGate.resolve();
await tick();
await tick();
assert(
	attempts.get(45) === 2 &&
		manager.snapshot().tasks.find((task) => task.topicId === 45)?.phase ===
			'ready' &&
		notices.some((message) =>
			message.includes('遇到 429，已保存断点')),
	'等待结束后必须用同一任务从永久 Topic 断点继续，并在成功后回到 ready',
);

manager.enqueue(46, 'Cloudflare 断点续传 Topic');
await tick();
await tick();
const challengedTask = manager.snapshot().tasks.find((task) =>
	task.topicId === 46);
assert(
	challengedTask?.phase === 'waiting-challenge' &&
		challengedTask.completed === 3 &&
		challengedTask.total === 8 &&
		challengedTask.detail.includes('等待 Cloudflare 验证通过') &&
		mount.querySelector(
			'[data-topic-download-action="cancel"][data-topic-id="46"]',
		) !== null,
	'Cloudflare 型 429 必须停在共享验证闸门并保留断点，不能直接变成下载失败',
);
challengeResumeGate.resolve();
await tick();
await tick();
assert(
	attempts.get(46) === 2 &&
		manager.snapshot().tasks.find((task) => task.topicId === 46)?.phase ===
			'ready' &&
		notices.some((message) => message.includes('等待 Cloudflare 验证通过')),
	'共享验证通过后必须让同一下载任务自动回到原请求管线继续',
);
manager.enqueue(47, '持续 429 有界续传 Topic');
await tick();
await tick();
const boundedRateLimitTask = manager.snapshot().tasks.find((task) =>
	task.topicId === 47);
assert(
	attempts.get(47) === 9 &&
		boundedRateLimitTask?.phase === 'error' &&
		boundedRateLimitTask.completed === 9 &&
		boundedRateLimitTask.error.includes('连续续传已达上限'),
	'下载即使在每轮 429 前取得新进度，也只能累计执行有限次自动续传',
);
manager.enqueue(48, '反复 Cloudflare 有界续传 Topic');
await tick();
await tick();
const boundedChallengeTask = manager.snapshot().tasks.find((task) =>
	task.topicId === 48);
assert(
	attempts.get(48) === 2 &&
		boundedChallengeTask?.phase === 'error' &&
		boundedChallengeTask.completed === 2 &&
		boundedChallengeTask.error.includes('已停止自动续传'),
	'一次自动续传后若再次触发 Cloudflare，必须保存断点并停止，不能形成验证循环',
);
removalChoices.push('remove-record-and-cache');
mount.querySelector<HTMLButtonElement>(
	'[data-topic-download-action="remove"][data-topic-id="46"]',
)!.click();
await tick();
await tick();
assert(
	notices.some((message) => message.includes('已保存到下载历史')) &&
		notices.some((message) => message.includes('下载失败')),
	'完成与失败都必须通过统一反馈端口通知用户',
);
const selectionMode = mount.querySelector<HTMLSelectElement>(
	'.ldp-topic-download-selection-mode',
)!;
const customSelection = mount.querySelector<HTMLInputElement>(
	'.ldp-topic-download-custom-selection > input',
)!;
assert(
	selectionMode.classList.contains('ldp-reader-select') &&
		selectionMode.dataset.readerSelectEnhanced === '1' &&
		selectionMode.parentElement?.classList.contains('ldp-select-surface') ===
			true &&
		selectionMode.parentElement?.querySelector('.ldp-select-menu') !== null,
	'下载管理器即使独立浮到 Reader 顶层，也必须主动挂载统一下拉展开层',
);
selectionMode.querySelector<HTMLOptionElement>('[value="custom"]')!.selected = true;
selectionMode.dispatchEvent(new parsedWindow.Event('change'));
const workerSelectionCountBeforeInvalidInput = workerSelections.length;
customSelection.value = '1，3';
customSelection.dispatchEvent(new parsedWindow.Event('input'));
assert(
	customSelection.getAttribute('aria-invalid') === 'true' &&
		mount.querySelector('.ldp-topic-download-selection-error')
			?.textContent?.includes('英文逗号') === true,
	'自定义楼层必须在输入时提示非法字符，而不是伪装成可下载范围',
);
mount.querySelector<HTMLButtonElement>('.ldp-topic-download-current')!.click();
await tick();
assert(
	workerSelections.length === workerSelectionCountBeforeInvalidInput,
	'非法自定义楼层必须在进入后台 worker 前再次阻断',
);
customSelection.value = '1,3,8-10';
customSelection.dispatchEvent(new parsedWindow.Event('input'));
assert(
	customSelection.hasAttribute('aria-invalid') === false &&
		mount.querySelector<HTMLElement>(
			'.ldp-topic-download-selection-error',
		)?.hidden === true,
	'修正为合法楼层表达式后必须即时清除错误状态',
);
mount.querySelector<HTMLButtonElement>('.ldp-topic-download-current')!.click();
await tick();
await tick();
assert(
	workerSelections.at(-1)?.mode === 'custom' &&
		workerSelections.at(-1)?.postNumbers.join(',') === '1,3,8,9,10',
	'自定义楼层输入必须规范化后传给后台下载 worker',
);
const customWorkerCount = workerSelections.length;
manager.enqueue(41, '当前 Topic', {
	mode: 'custom',
	expression: '1,3,8,9,10',
	postNumbers: Object.freeze([]),
});
await tick();
assert(
	workerSelections.length === customWorkerCount,
	'表达方式不同但规范化楼层相同的自定义范围必须识别为重复下载',
);
assert(
	selectionMode.querySelector('[value="op"]') === null,
	'新下载任务不得再把只看楼主暴露为下载裁剪范围',
);
manager.enqueue(41, '当前 Topic', opSelection);
await tick();
await tick();
assert(
	workerSelections.at(-1)?.mode === 'op',
	'旧版只看楼主任务仍须兼容执行和恢复，但不再作为新下载入口',
);
selectionMode.querySelector<HTMLOptionElement>('[value="all"]')!.selected = true;
selectionMode.dispatchEvent(new parsedWindow.Event('change'));
assert(
	selectionMode.value === 'all' &&
		customSelection.parentElement?.hidden === true &&
		mount.querySelector('.ldp-topic-download-select-all') === null,
	'全部楼层只保留在范围下拉内，自定义输入区不得提供重复按钮',
);
manager.destroy();
assert(
	mount.querySelector('.ldp-topic-download-manager') === null &&
		mount.querySelector('.ldp-reader-floating-window') === null,
	'下载管理销毁必须释放浮窗和未完成任务',
);

const restoredViewed: string[] = [];
const restoredManager = new ReaderTopicDownloadManager({
	document,
	mount,
	floating: true,
	geometryStorage,
	currentTopic: () => null,
	worker: async () => {
		throw new Error('恢复本地备份时不应重新请求 Topic');
	},
	downloads: { save: () => {} },
	artifacts: artifactStore,
	viewHtml: (_html, title) => {
		restoredViewed.push(title);
	},
	requestFrame: (callback) => {
		callback(0);
		return 0;
	},
	cancelFrame: () => {},
});
await tick();
restoredManager.openManager();
assert(
	restoredManager.element.style.left === '370px' &&
		restoredManager.element.style.top === '10px' &&
		restoredManager.element.style.width === '560px' &&
		restoredManager.element.style.height === '680px',
	'重新打开 Reader 后必须从四集合共享几何恢复下载历史浮窗',
);
mount.querySelector<HTMLButtonElement>(
	'[data-topic-download-action="view"][data-topic-id="41"]',
)!.click();
await tick();
assert(
	restoredManager.snapshot().tasks.some((task) =>
		task.topicId === 41 && task.phase === 'ready' &&
			task.selection.mode === 'op' && task.archiveStatus === 404) &&
		restoredViewed.includes('当前 Topic'),
	'重新打开 Reader 后必须从持久备份恢复下载范围、404 版本与历史，原下载文件移动后仍可查看',
);
const externalArtifact = Object.freeze({
	...backups.get(41)!,
	topicId: discourseTopicId(77),
	title: '其他标签下载的 Topic',
	filename: 'topic-77.html',
});
backups.set(77, externalArtifact);
await restoredManager.reloadExternal();
assert(
	restoredManager.snapshot().tasks.some((task) =>
		task.topicId === 77 && task.title === '其他标签下载的 Topic'),
	'其他标签新增 HTML 备份后必须局部刷新下载历史，且不得重新请求 Topic',
);
backups.delete(77);
await restoredManager.reloadExternal();
assert(
	!restoredManager.snapshot().tasks.some((task) => task.topicId === 77),
	'其他标签删除 HTML 备份后必须从当前下载历史投影移除对应记录',
);
restoredManager.destroy();

const baseHistoryRecord = backups.get(41)!;
for (let topicId = 100; topicId < 110; topicId += 1) {
	backups.set(topicId, Object.freeze({
		...baseHistoryRecord,
		topicId: discourseTopicId(topicId),
		title: `归档 Topic ${topicId}`,
		html: `<!doctype html><title>Archive ${topicId}</title>`,
		filename: `archive-${topicId}.html`,
		createdAt: baseHistoryRecord.createdAt + topicId,
		finishedAt: baseHistoryRecord.finishedAt + topicId,
	}));
}
const historyManager = new ReaderTopicDownloadManager({
	document,
	mount,
	floating: true,
	currentTopic: () => null,
	worker: async () => {
		throw new Error('下载历史本地分页不应重新请求 Topic');
	},
	downloads: { save: () => {} },
	artifacts: artifactStore,
	requestFrame: (callback) => {
		callback(0);
		return 0;
	},
	cancelFrame: () => {},
});
await tick();
historyManager.openManager();
assert(
	mount.querySelectorAll('.ldp-topic-download-task').length === 8 &&
		mount.querySelector('.ldp-topic-download-pagination')?.hasAttribute('hidden') ===
			false &&
		mount.querySelector('.ldp-topic-download-pagination > span')?.textContent ===
			'第 1 / 2 页',
	'下载历史超过单页容量后必须按最近顺序分页，首屏固定显示 8 条记录',
);
mount.querySelector<HTMLButtonElement>('.ldp-topic-download-page-next')!.click();
assert(
	mount.querySelectorAll('.ldp-topic-download-task').length === 4 &&
		mount.querySelector('.ldp-topic-download-pagination > span')?.textContent ===
			'第 2 / 2 页',
	'下载历史下一页必须只投影剩余记录并更新页码边界',
);
const historySearch = mount.querySelector<HTMLInputElement>(
	'.ldp-topic-download-search > input',
)!;
historySearch.value = '107';
historySearch.dispatchEvent(new parsedWindow.Event('input'));
assert(
	mount.querySelectorAll('.ldp-topic-download-task').length === 1 &&
		mount.querySelector('.ldp-topic-download-task strong')?.textContent ===
			'归档 Topic 107' &&
		mount.querySelector('.ldp-topic-download-history-count')?.textContent ===
			'1 / 12 条',
	'下载历史搜索必须覆盖 Topic ID、标题和文件名，并从搜索结果第一页展示',
);
historySearch.value = '';
historySearch.dispatchEvent(new parsedWindow.Event('input'));
mount.querySelector<HTMLButtonElement>('.ldp-topic-download-batch-toggle')!.click();
mount.querySelector<HTMLButtonElement>('.ldp-topic-download-select-page')!.click();
mount.querySelector<HTMLButtonElement>('.ldp-topic-download-page-next')!.click();
const nextPageSelection = mount.querySelector<HTMLInputElement>(
	'[data-topic-download-select]',
)!;
nextPageSelection.checked = true;
nextPageSelection.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
assert(
	mount.querySelector('.ldp-topic-download-batch-bar > span')?.textContent ===
		'已选 9 条' &&
		mount.querySelector<HTMLButtonElement>(
			'.ldp-topic-download-remove-selected',
		)?.disabled === false,
	'批量管理必须支持当前页全选，并在翻页后继续保留和追加已选记录',
);
historyManager.destroy();

const fallbackParsed = parseHTML(
	'<!doctype html><html><head><script nonce="fallback-view-nonce"></script></head>' +
	'<body><main id="fallback-mount"></main></body></html>',
);
const fallbackDocument = fallbackParsed.document as unknown as Document;
const fallbackWindow = fallbackParsed.window as unknown as Window;
const fallbackUrlDescriptor = Object.getOwnPropertyDescriptor(
	fallbackWindow,
	'URL',
);
const openedUrls: string[] = [];
const revokedUrls: string[] = [];
const hydratedWindows: Window[] = [];
const viewedBlobs: Blob[] = [];
Object.defineProperty(fallbackWindow, 'URL', {
	configurable: true,
	value: {
		createObjectURL: (blob: Blob) => {
			viewedBlobs.push(blob);
			return 'blob:https://linux.do/offline-topic-99';
		},
		revokeObjectURL: (value: string) => revokedUrls.push(value),
	},
});
Object.defineProperty(fallbackWindow, 'open', {
	configurable: true,
	value: (url: string): Window => {
		openedUrls.push(url);
		return {
			opener: {},
			addEventListener: (_name: string, listener: EventListener) => listener(
				new fallbackParsed.window.Event('load'),
			),
		} as unknown as Window;
	},
});
const fallbackManager = new ReaderTopicDownloadManager({
	document: fallbackDocument,
	mount: fallbackDocument.querySelector<HTMLElement>('#fallback-mount')!,
	currentTopic: () => null,
	worker: async (topicId) => Object.freeze({
		...artifact(topicId),
		html: '<!doctype html><script id="ldp-offline-topic-runtime">' +
			'globalThis.__offlineHydrated = true;<\/script>',
	}),
	downloads: { save: () => {} },
	hydrateHtmlWindow: (targetWindow) => {
		hydratedWindows.push(targetWindow);
	},
	requestFrame: (callback) => {
		callback(0);
		return 0;
	},
	cancelFrame: () => {},
});
fallbackManager.enqueue(99, '新标签 Topic');
await tick();
await tick();
fallbackDocument.querySelector<HTMLButtonElement>(
	'[data-topic-download-action="view"][data-topic-id="99"]',
)!.click();
await tick();
const viewedBlobHtml = await viewedBlobs[0]?.text();
assert(
	openedUrls.length === 1 && openedUrls[0]!.startsWith('blob:') &&
		hydratedWindows.length === 1 &&
		revokedUrls.length === 0 &&
		viewedBlobHtml?.includes(
			'<script id="ldp-offline-topic-runtime" nonce="fallback-view-nonce">',
		) === true,
	'默认查看必须用带宿主 CSP nonce 的 Blob HTML 打开新标签并主动水合，刷新后仍能自水合',
);
fallbackManager.destroy();
assert(
	revokedUrls.includes('blob:https://linux.do/offline-topic-99'),
	'下载管理销毁时必须统一回收仍保留的离线查看 Blob URL',
);
if (fallbackUrlDescriptor) {
	Object.defineProperty(fallbackWindow, 'URL', fallbackUrlDescriptor);
} else {
	Reflect.deleteProperty(fallbackWindow, 'URL');
}
assert(
	typeof globalThis.URL === 'function',
	'离线查看 Blob URL mock 必须恢复全局 URL，不能污染后续配置校验',
);
