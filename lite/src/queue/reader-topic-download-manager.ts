import { createReaderIcon } from '../components/reader-icon.js';
import type {
	ReaderTopicOfflineArtifactRecord,
	ReaderTopicOfflineArtifactStore,
} from '../archive/reader-topic-offline-artifact-repository.js';
import {
	prepareReaderTopicOfflineBlobHtml,
} from '../archive/reader-topic-offline-document.js';
import {
	eventElement,
	eventPathIncludes,
} from '../dom/event-target.js';
import { htmlElement as node } from '../dom/html-element.js';
import {
	discourseTopicId,
	type DiscourseTopicId,
} from '../discourse/identifiers.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import type { BlobDownloadPort } from '../media/reader-image-download-service.js';
import type {
	CoordinatedRequestResume,
} from '../network/coordinated-request-client.js';
import {
	ReaderWindowGeometryModel,
	ReaderWindowPointerController,
	type ReaderWindowPreferenceInput,
	type ReaderWindowSnapshot,
} from '../shell/reader-workspace.js';
import { ReaderSelectSurface } from '../shell/reader-select-surface.js';

export type ReaderTopicDownloadPhase =
	| 'queued'
	| 'loading-topic'
	| 'loading-posts'
	| 'loading-replies'
	| 'waiting-rate-limit'
	| 'waiting-challenge'
	| 'serializing'
	| 'ready'
	| 'error'
	| 'cancelled';

export interface ReaderTopicDownloadProgress {
	readonly phase: Exclude<
		ReaderTopicDownloadPhase,
		'ready' | 'error' | 'cancelled' | 'waiting-rate-limit' | 'waiting-challenge'
	>;
	readonly completed?: number;
	readonly total?: number;
	readonly detail?: string;
}

export interface ReaderTopicDownloadArtifact {
	readonly html: string;
	readonly filename: string;
	readonly postCount: number;
	readonly expectedPostCount: number;
	readonly complete: boolean;
}

export type ReaderTopicDownloadSelectionMode = 'all' | 'op' | 'custom';

export interface ReaderTopicDownloadSelection {
	readonly mode: ReaderTopicDownloadSelectionMode;
	readonly expression: string;
	readonly postNumbers: readonly number[];
}

const MAX_CUSTOM_POST_NUMBERS = 100_000;
const DOWNLOAD_HISTORY_PAGE_SIZE = 8;
const DOWNLOAD_REQUEST_AUTO_RESUME_LIMIT = 8;
const DOWNLOAD_CHALLENGE_AUTO_RESUME_LIMIT = 1;
export const READER_TOPIC_DOWNLOAD_WINDOW_GEOMETRY_STORAGE_KEY =
	'linuxdo-enhanced-reader:topic-download-window:v1';
const ALL_POSTS_SELECTION: ReaderTopicDownloadSelection = Object.freeze({
	mode: 'all',
	expression: '',
	postNumbers: Object.freeze([]),
});

export function parseReaderTopicDownloadPostSelection(
	rawValue: string,
): readonly number[] {
	const value = String(rawValue);
	if (!value) throw new Error('请输入楼层，例如 1,3,8-12');
	if (/[^0-9,-]/.test(value)) {
		throw new Error('仅支持数字、英文逗号 , 和连字符 -');
	}
	const selected = new Set<number>();
	for (const token of value.split(',')) {
		if (!token) throw new Error('楼层列表中存在空项');
		const single = /^(\d+)$/.exec(token);
		const range = /^(\d+)-(\d+)$/.exec(token);
		if (!single && !range) throw new Error(`无法识别楼层“${token}”`);
		const start = Number(single?.[1] ?? range?.[1]);
		const end = Number(single?.[1] ?? range?.[2]);
		if (
			!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
			start < 1 || end < start
		) throw new Error(`楼层范围“${token}”无效`);
		for (let postNumber = start; postNumber <= end; postNumber += 1) {
			if (
				!selected.has(postNumber) &&
				selected.size >= MAX_CUSTOM_POST_NUMBERS
			) {
				throw new Error(`自定义楼层最多选择 ${MAX_CUSTOM_POST_NUMBERS} 层`);
			}
			selected.add(postNumber);
		}
	}
	return Object.freeze([...selected].sort((left, right) => left - right));
}

function normalizedSelection(
	selection: ReaderTopicDownloadSelection = ALL_POSTS_SELECTION,
): ReaderTopicDownloadSelection {
	if (selection.mode === 'all') return ALL_POSTS_SELECTION;
	if (selection.mode === 'op') {
		return Object.freeze({
			mode: 'op',
			expression: '',
			postNumbers: Object.freeze([]),
		});
	}
	const expression = String(selection.expression);
	return Object.freeze({
		mode: 'custom',
		expression,
		postNumbers: parseReaderTopicDownloadPostSelection(expression),
	});
}

function sameSelection(
	left: ReaderTopicDownloadSelection,
	right: ReaderTopicDownloadSelection,
): boolean {
	if (left.mode !== right.mode) return false;
	if (left.mode !== 'custom') return true;
	return left.postNumbers.length === right.postNumbers.length &&
		left.postNumbers.every((postNumber, index) =>
			postNumber === right.postNumbers[index]);
}

function selectionLabel(selection: ReaderTopicDownloadSelection): string {
	if (selection.mode === 'all') return '全部楼层';
	if (selection.mode === 'op') return '只看楼主';
	return `自定义 ${selection.expression}`;
}

export interface ReaderTopicDownloadSelectablePost {
	readonly post_number?: unknown;
	readonly username?: unknown;
}

export interface ReaderTopicDownloadPostSelectionResult<TPost> {
	/** 完整正文集合，供离线版保留所选楼层的讨论上下文。 */
	readonly posts: readonly TPost[];
	/** null 表示正常显示全部；数组表示像“只看楼主”一样投影这些锚点。 */
	readonly mainPostNumbers: readonly number[] | null;
	readonly expectedPostCount: number;
	readonly filenameScope: string;
}

export interface ReaderTopicDownloadCoverage {
	readonly complete: boolean;
	readonly warning: string;
}

export interface ReaderTopicDownloadLocalArchivePlan {
	readonly completed: number;
	readonly total: number;
	readonly missingCanonicalPostCount: number;
	readonly streamComplete: boolean;
}

/**
 * Topic 已确认不可用且仍有本地正文时，下载必须切到纯本地路径，不能再用补齐请求
 * 把一份可用的部分存档变成 404/410 下载失败。
 */
export function readerTopicDownloadLocalArchivePlan(input: Readonly<{
	readonly topicStatus: unknown;
	readonly cachedPostCount: number;
	readonly expectedPostCount: number;
	readonly streamPostCount: number;
	readonly missingStreamPostCount: number;
	readonly streamComplete: boolean;
}>): ReaderTopicDownloadLocalArchivePlan | null {
	const topicStatus = Number(input.topicStatus);
	const completed = Math.max(0, Math.floor(Number(input.cachedPostCount) || 0));
	if (![403, 404, 410].includes(topicStatus) || completed < 1) return null;
	const total = Math.max(
		completed,
		Math.max(0, Math.floor(Number(input.expectedPostCount) || 0)),
		Math.max(0, Math.floor(Number(input.streamPostCount) || 0)),
	);
	const missingCanonicalPostCount = Math.max(
		Math.max(0, Math.floor(Number(input.missingStreamPostCount) || 0)),
		total - completed,
	);
	return Object.freeze({
		completed,
		total,
		missingCanonicalPostCount,
		streamComplete:
			input.streamComplete === true && missingCanonicalPostCount === 0,
	});
}

/**
 * canonical 正文缺失才阻断正常在线下载；reply_count 可能包含当前账号不可见回复，
 * 因此讨论关系未完全确认时降级导出并明确标记，不能把 0 个正文缺失误报成失败。
 */
export function readerTopicDownloadCoverage(input: Readonly<{
	readonly selectionMode: ReaderTopicDownloadSelectionMode;
	readonly streamComplete: boolean;
	readonly missingCanonicalPostCount: number;
	readonly repliesComplete: boolean;
	readonly archived: boolean;
}>): ReaderTopicDownloadCoverage {
	const missingCanonicalPostCount = Math.max(
		0,
		Math.floor(Number(input.missingCanonicalPostCount) || 0),
	);
	if (!input.streamComplete && !input.archived) {
		throw new Error(input.selectionMode === 'all'
			? `全帖正文尚未补齐：缺少 ${missingCanonicalPostCount} 个 canonical 楼层`
			: `所选楼层的正文上下文尚未补齐：缺少 ${missingCanonicalPostCount} ` +
				'个 canonical 楼层');
	}
	const warnings: string[] = [];
	if (!input.streamComplete) {
		warnings.push(missingCanonicalPostCount > 0
			? `仅保留当前可用正文，缺少 ${missingCanonicalPostCount} 个楼层`
			: '仅保留当前可用正文，完整性未能确认');
	}
	if (!input.repliesComplete) {
		warnings.push('正文已补齐，部分回复关系无法确认');
	}
	return Object.freeze({
		complete: input.streamComplete && input.repliesComplete,
		warning: warnings.join('；'),
	});
}

/**
 * 只负责把已取得的正文投影为导出范围，不改变中央 Topic 缓存。
 * 楼主身份优先使用 canonical Topic owner；省略时兼容按首楼识别。
 */
export function selectReaderTopicDownloadPosts<
	TPost extends ReaderTopicDownloadSelectablePost,
>(
	availablePosts: readonly TPost[],
	selection: ReaderTopicDownloadSelection,
	ownerUsername = '',
): ReaderTopicDownloadPostSelectionResult<TPost> {
	const selected = normalizedSelection(selection);
	if (selected.mode === 'all') {
		return Object.freeze({
			posts: Object.freeze([...availablePosts]),
			mainPostNumbers: null,
			expectedPostCount: availablePosts.length,
			filenameScope: '',
		});
	}
	if (selected.mode === 'op') {
		const starter = availablePosts.find((post) => Number(post.post_number) === 1);
		const opUsername = String(ownerUsername || starter?.username || '').trim();
		if (!opUsername) throw new Error('无法识别 Topic 楼主 OP');
		const anchors = Object.freeze(availablePosts.filter((post) =>
			String(post.username ?? '') === opUsername));
		if (!anchors.length) throw new Error('所选下载范围没有可用正文');
		return Object.freeze({
			posts: Object.freeze([...availablePosts]),
			mainPostNumbers: Object.freeze(anchors.map((post) =>
				Number(post.post_number))),
			expectedPostCount: anchors.length,
			filenameScope: 'op',
		});
	}
	const selectedNumbers = new Set(selected.postNumbers);
	const anchors = Object.freeze(availablePosts.filter((post) =>
		selectedNumbers.has(Number(post.post_number))));
	const foundNumbers = new Set(anchors.map((post) => Number(post.post_number)));
	const missing = selected.postNumbers.filter((postNumber) =>
		!foundNumbers.has(postNumber));
	if (missing.length) {
		throw new Error(`未找到自定义楼层：${missing.slice(0, 12).join(',')}`);
	}
	if (!anchors.length) throw new Error('所选下载范围没有可用正文');
	return Object.freeze({
		posts: Object.freeze([...availablePosts]),
		mainPostNumbers: Object.freeze(anchors.map((post) =>
			Number(post.post_number))),
		expectedPostCount: selected.postNumbers.length,
		filenameScope: `floors-${selected.expression}`
			.replace(/[,，\s]+/g, '_')
			.replace(/[^0-9_-]/g, '')
			.slice(0, 64),
	});
}

function restoredSelection(
	entry: Pick<
		ReaderTopicOfflineArtifactRecord,
		'selectionMode' | 'selectionExpression'
	>,
): ReaderTopicDownloadSelection {
	try {
		return normalizedSelection({
			mode: entry.selectionMode ?? 'all',
			expression: entry.selectionExpression ?? '',
			postNumbers: Object.freeze([]),
		});
	} catch {
		return ALL_POSTS_SELECTION;
	}
}

export interface ReaderTopicDownloadTaskSnapshot {
	readonly topicId: DiscourseTopicId;
	readonly title: string;
	readonly selection: ReaderTopicDownloadSelection;
	readonly phase: ReaderTopicDownloadPhase;
	readonly completed: number;
	readonly total: number;
	readonly detail: string;
	readonly error: string;
	readonly filename: string;
	readonly complete: boolean;
	readonly createdAt: number;
	readonly finishedAt: number;
	/** 仅表示 Reader 曾触发浏览器下载，不表示下载目录中的文件仍存在。 */
	readonly localDownloadRequestedAt: number;
}

export type ReaderTopicDownloadRemovalChoice =
	| 'cancel'
	| 'remove-record'
	| 'remove-record-and-cache';

export interface ReaderTopicDownloadRemovalContext {
	readonly topicId: DiscourseTopicId;
	readonly title: string;
	readonly filename: string;
	readonly hasCachedHtml: boolean;
	/** 0 表示 Reader 没有记录到本地下载动作。 */
	readonly localDownloadRequestedAt: number;
}

export interface ReaderTopicDownloadManagerSnapshot {
	readonly open: boolean;
	readonly tasks: readonly ReaderTopicDownloadTaskSnapshot[];
}

export interface ReaderTopicDownloadManagerOptions {
	readonly document: Document;
	readonly mount: HTMLElement;
	readonly floating?: boolean;
	/** 浮窗优先停靠到当前 Reader 的下载历史按钮旁。 */
	readonly positionAnchor?: () => HTMLElement | null;
	/** 与阅读器偏好使用同一安全 storage；这里只持久化浮窗几何。 */
	readonly geometryStorage?: Pick<Storage, 'getItem' | 'setItem'>;
	readonly geometryStorageKey?: string;
	readonly currentTopic: () => Readonly<{
		readonly topicId: DiscourseTopicId;
		readonly title: string;
	}> | null;
	readonly worker: (
		topicId: DiscourseTopicId,
		title: string,
		signal: AbortSignal,
		report: (progress: ReaderTopicDownloadProgress) => void,
		selection: ReaderTopicDownloadSelection,
	) => Promise<ReaderTopicDownloadArtifact>;
	readonly downloads: BlobDownloadPort;
	readonly artifacts?: ReaderTopicOfflineArtifactStore;
	readonly viewHtml?: (
		html: string,
		title: string,
		topicId: DiscourseTopicId,
	) => void | Promise<void>;
	readonly hydrateHtmlWindow?: (targetWindow: Window) => void;
	/** 必须由 Shell 统一确认；未提供时删除动作安全取消。 */
	readonly confirmRemoval?: (
		context: ReaderTopicDownloadRemovalContext,
		host: HTMLElement,
	) => ReaderTopicDownloadRemovalChoice | Promise<ReaderTopicDownloadRemovalChoice>;
	readonly confirmBulkRemoval?: (
		contexts: readonly ReaderTopicDownloadRemovalContext[],
		host: HTMLElement,
	) => ReaderTopicDownloadRemovalChoice | Promise<ReaderTopicDownloadRemovalChoice>;
	readonly notify?: (message: string) => void;
	readonly now?: () => number;
	/** 只接受中央请求协调器签发的恢复凭据；不在下载层解析 429/Cloudflare 或自建退避。 */
	readonly requestResume?: (
		error: unknown,
	) => CoordinatedRequestResume | null;
	readonly requestFrame?: (callback: FrameRequestCallback) => number;
	readonly cancelFrame?: (id: number) => void;
	readonly parentScope?: LifecycleScope;
}

interface ReaderTopicDownloadTask extends ReaderTopicDownloadTaskSnapshot {
	selection: ReaderTopicDownloadSelection;
	phase: ReaderTopicDownloadPhase;
	completed: number;
	total: number;
	detail: string;
	error: string;
	filename: string;
	complete: boolean;
	finishedAt: number;
	localDownloadRequestedAt: number;
	artifact: ReaderTopicDownloadArtifact | null;
	controller: AbortController | null;
	requestResumeCount: number;
	challengeResumeCount: number;
	resumeAvailable: boolean;
}

function button(
	document: Document,
	className: string,
	label: string,
	iconName: string,
): HTMLButtonElement {
	const result = node(document, 'button', className);
	result.type = 'button';
	result.setAttribute('aria-label', label);
	result.append(createReaderIcon(document, iconName));
	return result;
}

function phaseLabel(task: ReaderTopicDownloadTask): string {
	const scope = selectionLabel(task.selection);
	const withProgress = (label: string): string => {
		if (task.total < 1) return label;
		const percentage = Math.min(
			100,
			Math.max(0, Math.round(task.completed / task.total * 100)),
		);
		return `${label} · ${percentage}%`;
	};
	if (task.phase === 'queued') return `等待后台下载 · ${scope}`;
	if (task.phase === 'loading-topic') return task.detail || '正在读取 Topic';
	if (task.phase === 'loading-posts') {
		return withProgress(
			task.detail || `正在检查缓存并补齐正文 ${task.completed}/${task.total || '?'}`,
		);
	}
	if (task.phase === 'loading-replies') {
		return withProgress(task.detail || '正在检查回复关系');
	}
	if (task.phase === 'waiting-rate-limit') {
		return withProgress(
			task.detail || '遇到 HTTP 429，已保存断点并等待自动续传',
		);
	}
	if (task.phase === 'waiting-challenge') {
		return withProgress(
			task.detail || '等待 Cloudflare 验证通过后自动续传',
		);
	}
	if (task.phase === 'serializing') return task.detail || '正在生成离线 HTML';
	if (task.phase === 'ready') {
		if (task.detail) return task.detail;
		return task.complete
			? `已完成 · ${task.completed}/${task.total} 楼 · ${scope}`
			: `已导出可用存档 · ${task.completed}/${task.total || '?'} 楼 · ${scope}`;
	}
	if (task.phase === 'cancelled') return '已取消';
	return task.error ? `失败 · ${task.error}` : '下载失败';
}

function emptyWindowPreferences(): ReaderWindowPreferenceInput {
	return Object.freeze({
		readerWindowWidth: 0,
		readerWindowHeight: 0,
		readerWindowX: 0,
		readerWindowY: 0,
		readerWindowLocked: false,
		readerWindowPinned: false,
	});
}

function storedWindowPreferences(
	storage: Pick<Storage, 'getItem'> | undefined,
	key: string,
): ReaderWindowPreferenceInput | null {
	try {
		const raw = storage?.getItem(key);
		if (!raw) return null;
		const value = JSON.parse(raw) as Partial<ReaderWindowPreferenceInput>;
		const width = Number(value.readerWindowWidth);
		const height = Number(value.readerWindowHeight);
		const left = Number(value.readerWindowX);
		const top = Number(value.readerWindowY);
		if (
			!Number.isFinite(width) || width <= 0 ||
			!Number.isFinite(height) || height <= 0 ||
			!Number.isFinite(left) || !Number.isFinite(top)
		) return null;
		return Object.freeze({
			readerWindowWidth: width,
			readerWindowHeight: height,
			readerWindowX: left,
			readerWindowY: top,
			readerWindowLocked: false,
			readerWindowPinned: false,
		});
	} catch {
		return null;
	}
}

/**
 * Topic 下载的唯一后台任务与管理浮窗 owner。
 *
 * worker 继续复用中央 Topic bundle；本类只串行任务、保存进度、触发文件下载和提供查看/重试。
 */
export class ReaderTopicDownloadManager {
	readonly scope: LifecycleScope;
	readonly changes = new Signal<ReaderTopicDownloadManagerSnapshot>();
	readonly windowGeometry: ReaderWindowGeometryModel | null;
	readonly windowPointer: ReaderWindowPointerController | null;
	readonly #options: ReaderTopicDownloadManagerOptions;
	readonly #now: () => number;
	readonly #mount: HTMLElement;
	readonly #floatingHost: HTMLElement | null;
	readonly #details: HTMLElement;
	readonly #summaryCount: HTMLElement;
	readonly #downloadCurrent: HTMLButtonElement;
	readonly #downloadCurrentLabel: HTMLElement;
	readonly #downloadPreview: HTMLElement;
	readonly #downloadPreviewTitle: HTMLElement;
	readonly #downloadPreviewMeta: HTMLElement;
	readonly #closeManagerButton: HTMLButtonElement | null;
	readonly #selectionMode: HTMLSelectElement;
	readonly #selectSurface: ReaderSelectSurface;
	readonly #customSelection: HTMLInputElement;
	readonly #selectionError: HTMLElement;
	readonly #historySearch: HTMLInputElement;
	readonly #historyCount: HTMLElement;
	readonly #historyBatchToggle: HTMLButtonElement;
	readonly #historyBatchBar: HTMLElement;
	readonly #historySelectPage: HTMLButtonElement;
	readonly #historySelectionCount: HTMLElement;
	readonly #historyRemoveSelected: HTMLButtonElement;
	readonly #list: HTMLElement;
	readonly #historyPagination: HTMLElement;
	readonly #historyPagePrevious: HTMLButtonElement;
	readonly #historyPageLabel: HTMLElement;
	readonly #historyPageNext: HTMLButtonElement;
	readonly #tasks = new Map<DiscourseTopicId, ReaderTopicDownloadTask>();
	readonly #requestFrame: (callback: FrameRequestCallback) => number;
	readonly #cancelFrame: (id: number) => void;
	#tail = Promise.resolve();
	#renderFrame = 0;
	#positionFrame = 0;
	#renderKey = '';
	#managerVisible = false;
	#managerOpen = false;
	#geometryCustomized = false;
	#historyPage = 0;
	#historyBatchMode = false;
	#visibleHistoryTopicIds: readonly DiscourseTopicId[] = Object.freeze([]);
	readonly #selectedHistoryTopics = new Set<DiscourseTopicId>();
	readonly #removing = new Set<DiscourseTopicId>();
	readonly #viewObjectUrls = new Set<Readonly<{
		readonly urlApi: Pick<typeof URL, 'revokeObjectURL'>;
		readonly value: string;
	}>>();

	constructor(options: ReaderTopicDownloadManagerOptions) {
		this.#options = options;
		this.#now = options.now ?? Date.now;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		const view = options.document.defaultView;
		this.#floatingHost = options.floating
			? node(
				options.document,
				'div',
				'ldp-topic-download-floating-host',
			)
			: null;
		if (this.#floatingHost) {
			const surfaceRoot = options.mount.getRootNode();
			if (surfaceRoot.nodeType === 11 && 'host' in surfaceRoot) {
				(surfaceRoot as ShadowRoot).append(this.#floatingHost);
			} else {
				options.mount.append(this.#floatingHost);
			}
		}
		this.#mount = this.#floatingHost ?? options.mount;
		this.#requestFrame = options.requestFrame ?? ((callback) => {
			if (typeof view?.requestAnimationFrame === 'function') {
				return view.requestAnimationFrame(callback);
			}
			callback(0);
			return 0;
		});
		this.#cancelFrame = options.cancelFrame ?? ((id) =>
			view?.cancelAnimationFrame?.(id));
		this.#details = node(
			options.document,
			'section',
			'ldp-topic-download-manager',
		);
		this.#details.classList.toggle('is-floating', options.floating === true);
		this.#managerVisible = options.floating !== true;
		if (options.floating) this.#details.hidden = true;
		const summary = node(
			options.document,
			'header',
			'ldp-topic-download-summary',
		);
		if (options.floating) summary.dataset.topicDownloadDragSurface = '1';
		summary.append(createReaderIcon(options.document, 'download'));
		const summaryLabel = node(options.document, 'span');
		summaryLabel.textContent = 'Topic 下载';
		this.#summaryCount = node(options.document, 'b');
		summary.append(summaryLabel, this.#summaryCount);
		this.#closeManagerButton = options.floating
			? button(
				options.document,
				'ldp-topic-download-close',
				'关闭 Topic 下载管理',
				'x',
			)
			: null;
		if (this.#closeManagerButton) summary.append(this.#closeManagerButton);
		const toolbar = node(
			options.document,
			'div',
			'ldp-topic-download-toolbar',
		);
		const selection = node(
			options.document,
			'div',
			'ldp-topic-download-selection',
		);
		const selectionLabelNode = node(options.document, 'label');
		const selectionLabelText = node(options.document, 'span');
		selectionLabelText.textContent = '下载范围';
		this.#selectionMode = options.document.createElement('select');
		this.#selectionMode.className =
			'ldp-reader-select ldp-topic-download-selection-mode';
		this.#selectionMode.setAttribute('aria-label', '选择 Topic 下载范围');
		for (const [value, label] of [
			['all', '全部楼层（默认）'],
			['custom', '自定义楼层'],
		] as const) {
			const option = options.document.createElement('option');
			option.value = value;
			option.textContent = label;
			option.selected = value === 'all';
			this.#selectionMode.append(option);
		}
		selectionLabelNode.append(selectionLabelText, this.#selectionMode);
		const customRow = node(
			options.document,
			'div',
			'ldp-topic-download-custom-selection',
		);
		this.#customSelection = options.document.createElement('input');
		this.#customSelection.type = 'text';
		this.#customSelection.inputMode = 'text';
		this.#customSelection.placeholder = '输入楼层，例如 1,3,8-12';
		this.#customSelection.setAttribute('aria-label', '输入自定义下载楼层');
		this.#customSelection.pattern =
			'[0-9]+(?:-[0-9]+)?(?:,[0-9]+(?:-[0-9]+)?)*';
		this.#customSelection.autocomplete = 'off';
		this.#customSelection.spellcheck = false;
		this.#customSelection.enterKeyHint = 'done';
		customRow.append(this.#customSelection);
		this.#selectionError = node(
			options.document,
			'small',
			'ldp-topic-download-selection-error',
		);
		this.#selectionError.hidden = true;
		this.#selectionError.setAttribute('aria-live', 'polite');
		selection.append(selectionLabelNode, customRow, this.#selectionError);
		this.#downloadCurrent = button(
			options.document,
			'ldp-topic-download-current',
			'开始后台下载当前 Topic',
			'download',
		);
		this.#downloadCurrentLabel = node(options.document, 'span');
		this.#downloadCurrentLabel.textContent = '开始后台下载';
		this.#downloadCurrent.append(this.#downloadCurrentLabel);
		selection.insertBefore(this.#downloadCurrent, customRow);
		this.#downloadPreview = node(
			options.document,
			'div',
			'ldp-topic-download-preview',
		);
		this.#downloadPreview.hidden = true;
		this.#downloadPreview.setAttribute('role', 'note');
		this.#downloadPreview.setAttribute('aria-live', 'polite');
		this.#downloadPreview.setAttribute('aria-atomic', 'true');
		this.#downloadPreview.append(createReaderIcon(options.document, 'download'));
		const downloadPreviewCopy = node(
			options.document,
			'span',
			'ldp-topic-download-preview-copy',
		);
		const downloadPreviewKicker = node(
			options.document,
			'small',
			'ldp-topic-download-preview-kicker',
		);
		downloadPreviewKicker.textContent = '即将下载';
		this.#downloadPreviewTitle = node(options.document, 'strong');
		this.#downloadPreviewMeta = node(options.document, 'small');
		downloadPreviewCopy.append(
			downloadPreviewKicker,
			this.#downloadPreviewTitle,
			this.#downloadPreviewMeta,
		);
		this.#downloadPreview.append(downloadPreviewCopy);
		selection.append(this.#downloadPreview);
		toolbar.append(selection);
		const history = node(
			options.document,
			'section',
			'ldp-topic-download-history',
		);
		const historyHead = node(
			options.document,
			'div',
			'ldp-topic-download-history-head',
		);
		const historySearchLabel = node(
			options.document,
			'label',
			'ldp-topic-download-search',
		);
		historySearchLabel.append(createReaderIcon(options.document, 'search'));
		this.#historySearch = options.document.createElement('input');
		this.#historySearch.type = 'search';
		this.#historySearch.placeholder = '搜索标题、Topic ID 或文件名';
		this.#historySearch.setAttribute('aria-label', '搜索 Topic 下载历史');
		historySearchLabel.append(this.#historySearch);
		this.#historyCount = node(
			options.document,
			'span',
			'ldp-topic-download-history-count',
		);
		this.#historyBatchToggle = button(
			options.document,
			'ldp-topic-download-batch-toggle',
			'进入批量管理',
			'list-checks',
		);
		const batchToggleLabel = node(options.document, 'span');
		batchToggleLabel.textContent = '批量管理';
		this.#historyBatchToggle.append(batchToggleLabel);
		const historyMeta = node(
			options.document,
			'span',
			'ldp-topic-download-history-meta',
		);
		historyMeta.append(this.#historyCount, this.#historyBatchToggle);
		historyHead.append(historySearchLabel, historyMeta);
		this.#historyBatchBar = node(
			options.document,
			'div',
			'ldp-topic-download-batch-bar',
		);
		this.#historyBatchBar.hidden = true;
		this.#historySelectPage = button(
			options.document,
			'ldp-topic-download-select-page',
			'选择当前页',
			'check-square',
		);
		const selectPageLabel = node(options.document, 'span');
		selectPageLabel.textContent = '全选本页';
		this.#historySelectPage.append(selectPageLabel);
		this.#historySelectionCount = node(options.document, 'span');
		this.#historyRemoveSelected = button(
			options.document,
			'ldp-topic-download-remove-selected',
			'移除已选下载记录',
			'trash',
		);
		const removeSelectedLabel = node(options.document, 'span');
		removeSelectedLabel.textContent = '移除已选';
		this.#historyRemoveSelected.append(removeSelectedLabel);
		this.#historyBatchBar.append(
			this.#historySelectPage,
			this.#historySelectionCount,
			this.#historyRemoveSelected,
		);
		this.#list = node(options.document, 'div', 'ldp-topic-download-list');
		this.#list.setAttribute('aria-live', 'polite');
		this.#historyPagination = node(
			options.document,
			'nav',
			'ldp-topic-download-pagination',
		);
		this.#historyPagination.setAttribute('aria-label', 'Topic 下载历史分页');
		this.#historyPagePrevious = button(
			options.document,
			'ldp-topic-download-page-previous',
			'上一页',
			'chevron-left',
		);
		this.#historyPageLabel = node(options.document, 'span');
		this.#historyPageNext = button(
			options.document,
			'ldp-topic-download-page-next',
			'下一页',
			'chevron-right',
		);
		this.#historyPagination.append(
			this.#historyPagePrevious,
			this.#historyPageLabel,
			this.#historyPageNext,
		);
		history.append(
			historyHead,
			this.#historyBatchBar,
			this.#list,
			this.#historyPagination,
		);
		const resizeDirections = Object.freeze([
			'n',
			's',
			'e',
			'w',
			'ne',
			'nw',
			'se',
			'sw',
		] as const);
		const resizeHandles = options.floating
			? resizeDirections.map((direction) => {
				const handle = node(
					options.document,
					'span',
					'ldp-topic-download-resize-handle',
				);
				handle.dataset.readerResize = direction;
				handle.dataset.resize = direction;
				handle.setAttribute('aria-hidden', 'true');
				return handle;
			})
			: [];
		this.#details.append(summary, toolbar, history, ...resizeHandles);
		this.#mount.append(this.#details);
		/*
		 * 浮动管理窗位于 Reader surfaceHost 之外，不能依赖 runtime 的全局扫描。
		 * 管理器直接持有自己的下拉 surface，确保首次打开也不会退回原生菜单。
		 */
		this.#selectSurface = new ReaderSelectSurface({
			document: options.document,
			root: this.#details,
			parentScope: this.scope,
		});
		const geometryStorageKey = options.geometryStorageKey ??
			READER_TOPIC_DOWNLOAD_WINDOW_GEOMETRY_STORAGE_KEY;
		const restoredGeometry = options.floating
			? storedWindowPreferences(options.geometryStorage, geometryStorageKey)
			: null;
		this.#geometryCustomized = restoredGeometry !== null;
		const readViewport = (): Readonly<{ width: number; height: number }> =>
			Object.freeze({
				width: Math.max(
					1,
					Number(view?.innerWidth) ||
						options.document.documentElement?.clientWidth ||
						options.mount.clientWidth || 1_024,
				),
				height: Math.max(
					1,
					Number(view?.innerHeight) ||
						options.document.documentElement?.clientHeight ||
						options.mount.clientHeight || 768,
				),
			});
		const viewport = readViewport();
		this.windowGeometry = options.floating
			? new ReaderWindowGeometryModel({
					preferences: restoredGeometry ?? emptyWindowPreferences(),
					viewportWidth: viewport.width,
					viewportHeight: viewport.height,
					mode: 'floating',
					policy: {
						margin: 8,
						minWidth: 520,
						minHeight: 480,
						compactWidth: 0,
						defaultWidth: 720,
						defaultHeight: 680,
						defaultViewportWidth: 0.72,
						defaultViewportHeight: 0.8,
					},
				})
			: null;
		this.windowGeometry?.changes.subscribe(
			(snapshot) => this.#applyWindowGeometry(snapshot),
			this.scope,
		);
		this.windowPointer = this.windowGeometry
			? new ReaderWindowPointerController({
					model: this.windowGeometry,
					overlay: this.#details,
					modal: this.#details,
					header: summary,
					...(view ? { viewportTarget: view } : {}),
					readViewport,
					onPersist: (patch) => {
						this.#geometryCustomized = true;
						try {
							options.geometryStorage?.setItem(
								geometryStorageKey,
								JSON.stringify(patch),
							);
						} catch {
							options.notify?.('Topic 下载浮窗位置保存失败');
						}
					},
					requestFrame: this.#requestFrame,
					cancelFrame: this.#cancelFrame,
					dragSurfaceSelector:
						'.ldp-topic-download-summary[data-topic-download-drag-surface]',
					blockedSelector:
						'button,input,select,textarea,label,a,[role="button"],' +
						'[contenteditable="true"]',
					interactingClassName: 'ldp-topic-download-interacting',
					restingTransform: 'none',
					projectPlacement: () => {},
					parentScope: this.scope,
				})
			: null;
		if (this.windowGeometry) {
			this.#applyWindowGeometry(this.windowGeometry.snapshot);
		}
		this.scope.add(() => {
			this.#selectSurface.destroy();
			if (this.#renderFrame) this.#cancelFrame(this.#renderFrame);
			if (this.#positionFrame) this.#cancelFrame(this.#positionFrame);
			for (const task of this.#tasks.values()) {
				task.controller?.abort(
					new DOMException('Topic 下载管理已关闭', 'AbortError'),
				);
			}
			for (const objectUrl of this.#viewObjectUrls) {
				objectUrl.urlApi.revokeObjectURL(objectUrl.value);
			}
			this.#viewObjectUrls.clear();
			this.#details.remove();
			this.#floatingHost?.remove();
			this.changes.clear();
		});
		this.scope.listen(this.#details, 'click', (event) => this.#click(event));
		if (options.floating) {
			this.scope.listen(options.document, 'pointerdown', (event) => {
				if (
					!this.#managerVisible ||
					this.#details.hidden ||
					this.#removing.size > 0 ||
					eventPathIncludes(event, this.#details)
				) return;
				this.closeManager();
			}, true);
			this.scope.listen(options.document, 'keydown', (event) => {
				if (
					(event as KeyboardEvent).key !== 'Escape' ||
					!this.#managerVisible
				) return;
				if (this.#removing.size > 0) return;
				event.preventDefault();
				event.stopImmediatePropagation();
				this.closeManager();
			}, true);
			if (view) {
				this.scope.listen(view, 'resize', () => this.#queuePosition());
			}
		}
		this.scope.listen(this.#selectionMode, 'change', () => {
			this.#syncSelectionControls();
			this.syncCurrent();
		});
		this.scope.listen(this.#customSelection, 'input', () => {
			this.#validateCustomSelection(false);
			this.syncCurrent();
		});
		this.scope.listen(this.#historySearch, 'input', () => {
			this.#historyPage = 0;
			this.#scheduleRender();
		});
		this.scope.listen(this.#historyBatchToggle, 'click', () => {
			this.#historyBatchMode = !this.#historyBatchMode;
			if (!this.#historyBatchMode) this.#selectedHistoryTopics.clear();
			this.#scheduleRender();
		});
		this.scope.listen(this.#historySelectPage, 'click', () => {
			const allSelected = this.#visibleHistoryTopicIds.length > 0 &&
				this.#visibleHistoryTopicIds.every((topicId) =>
					this.#selectedHistoryTopics.has(topicId));
			for (const topicId of this.#visibleHistoryTopicIds) {
				if (allSelected) this.#selectedHistoryTopics.delete(topicId);
				else this.#selectedHistoryTopics.add(topicId);
			}
			this.#scheduleRender();
		});
		this.scope.listen(this.#historyRemoveSelected, 'click', () => {
			void this.#confirmAndRemoveSelected();
		});
		this.scope.listen(this.#list, 'change', (event) => {
			const input = eventElement(event)?.closest<HTMLInputElement>(
				'[data-topic-download-select]',
			);
			if (!input) return;
			const topicId = discourseTopicId(Number(input.dataset.topicId));
			if (input.checked) this.#selectedHistoryTopics.add(topicId);
			else this.#selectedHistoryTopics.delete(topicId);
			this.#scheduleRender();
		});
		this.scope.listen(this.#historyPagePrevious, 'click', () => {
			if (this.#historyPage <= 0) return;
			this.#historyPage -= 1;
			this.#scheduleRender();
		});
		this.scope.listen(this.#historyPageNext, 'click', () => {
			this.#historyPage += 1;
			this.#scheduleRender();
		});
		this.#syncSelectionControls();
		this.syncCurrent();
		this.#render();
		void this.#restoreArtifacts();
	}

	get element(): HTMLElement {
		return this.#details;
	}

	snapshot(): ReaderTopicDownloadManagerSnapshot {
		return Object.freeze({
			open: this.#managerOpen,
			tasks: Object.freeze([...this.#tasks.values()]
				.sort((left, right) => right.createdAt - left.createdAt)
				.map((task) => this.#taskSnapshot(task))),
		});
	}

	syncCurrent(): void {
		const current = this.#options.currentTopic();
		const task = current ? this.#tasks.get(current.topicId) : null;
		const selection = this.#selectionForDuplicateCheck();
		const active = Boolean(
			task && !['ready', 'error', 'cancelled'].includes(task.phase),
		);
		const duplicateReady = Boolean(
			task?.phase === 'ready' && selection &&
				sameSelection(task.selection, selection),
		);
		this.#downloadCurrent.disabled = current === null || active || duplicateReady;
		this.#downloadCurrent.classList.toggle('is-active', active);
		this.#downloadCurrentLabel.textContent = duplicateReady
			? '已在下载历史'
			: active
			? task?.phase === 'waiting-rate-limit'
				? '等待断点续传'
				: task?.phase === 'waiting-challenge'
					? '等待过盾续传'
				: task?.phase === 'queued'
				? '已加入下载队列'
				: '正在后台下载'
			: '开始后台下载';
		this.#downloadCurrent.setAttribute(
			'aria-label',
			duplicateReady && current
				? `${current.title} 的${selectionLabel(selection!)}已在下载历史`
				: active && current
				? `${current.title} 正在后台下载`
				: '开始后台下载当前 Topic',
		);
		this.#downloadCurrent.dataset.topicId = current
			? String(current.topicId)
			: '';
		this.#downloadCurrent.dataset.topicTitle = current?.title ?? '';
		this.#downloadPreview.hidden = current === null || active || duplicateReady;
		this.#downloadPreviewTitle.textContent = current?.title ?? '';
		this.#downloadPreviewMeta.textContent = current
			? `Topic #${current.topicId} · ${this.#selectionPreviewLabel()}`
			: '';
	}

	#selectionForDuplicateCheck(): ReaderTopicDownloadSelection | null {
		const mode = this.#selectionMode.value as ReaderTopicDownloadSelectionMode;
		try {
			return normalizedSelection({
				mode,
				expression: mode === 'custom' ? this.#customSelection.value : '',
				postNumbers: Object.freeze([]),
			});
		} catch {
			return null;
		}
	}

	#selectionPreviewLabel(): string {
		const mode = this.#selectionMode.value as ReaderTopicDownloadSelectionMode;
		if (mode === 'all') return '全部楼层';
		if (mode === 'op') return '只看楼主';
		const expression = this.#customSelection.value.trim();
		return expression ? `自定义 ${expression}` : '自定义楼层（等待输入）';
	}

	#syncSelectionControls(): void {
		const custom = this.#selectionMode.value === 'custom';
		this.#customSelection.parentElement!.hidden = !custom;
		if (custom) this.#validateCustomSelection(false);
		else this.#clearSelectionError();
	}

	#clearSelectionError(): void {
		this.#selectionError.hidden = true;
		this.#selectionError.textContent = '';
		this.#customSelection.removeAttribute('aria-invalid');
	}

	#validateCustomSelection(requireValue: boolean): boolean {
		this.#clearSelectionError();
		if (this.#selectionMode.value !== 'custom') return true;
		if (!requireValue && !this.#customSelection.value) return true;
		try {
			parseReaderTopicDownloadPostSelection(this.#customSelection.value);
			return true;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.#selectionError.textContent = message;
			this.#selectionError.hidden = false;
			this.#customSelection.setAttribute('aria-invalid', 'true');
			return false;
		}
	}

	#readSelection(): ReaderTopicDownloadSelection | null {
		const mode = this.#selectionMode.value as ReaderTopicDownloadSelectionMode;
		if (mode === 'custom' && !this.#validateCustomSelection(true)) {
			this.#customSelection.focus();
			return null;
		}
		try {
			return normalizedSelection({
				mode,
				expression: mode === 'custom' ? this.#customSelection.value : '',
				postNumbers: Object.freeze([]),
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.#selectionError.textContent = message;
			this.#selectionError.hidden = false;
			this.#customSelection.setAttribute('aria-invalid', 'true');
			this.#customSelection.focus();
			return null;
		}
	}

	openManager(): boolean {
		if (this.scope.destroyed) return false;
		this.#managerVisible = true;
		this.#managerOpen = true;
		this.#details.hidden = false;
		this.#details.classList.add('is-open');
		this.#queuePosition();
		this.#emit();
		return true;
	}

	closeManager(): boolean {
		if (this.scope.destroyed || !this.#options.floating) return false;
		this.#managerVisible = false;
		this.#managerOpen = false;
		this.#details.classList.remove('is-open');
		this.#details.hidden = true;
		this.#emit();
		return true;
	}

	prepareCurrentDownload(): boolean {
		this.syncCurrent();
		if (this.#downloadCurrent.disabled || !this.openManager()) return false;
		this.#selectionMode.focus();
		return true;
	}

	enqueueCurrent(): ReaderTopicDownloadTaskSnapshot | null {
		const current = this.#options.currentTopic();
		if (!current) return null;
		const selection = this.#readSelection();
		if (!selection) return null;
		return this.enqueue(current.topicId, current.title, selection);
	}

	enqueue(
		rawTopicId: number,
		rawTitle: string,
		selection: ReaderTopicDownloadSelection = ALL_POSTS_SELECTION,
	): ReaderTopicDownloadTaskSnapshot {
		const topicId = discourseTopicId(rawTopicId);
		const title = String(rawTitle || `Topic #${topicId}`).replace(/\s+/g, ' ').trim();
		const selected = normalizedSelection(selection);
		this.openManager();
		const existing = this.#tasks.get(topicId);
		if (
			existing && (
				!['ready', 'error', 'cancelled'].includes(existing.phase) ||
				(existing.phase === 'ready' &&
					sameSelection(existing.selection, selected))
			)
		) {
			this.#scheduleRender();
			return this.#taskSnapshot(existing);
		}
		const resumeFromCheckpoint = Boolean(
			existing?.resumeAvailable &&
				sameSelection(existing.selection, selected),
		);
		const task: ReaderTopicDownloadTask = existing ?? {
			topicId,
			title,
			selection: selected,
			phase: 'queued',
			completed: 0,
			total: 0,
			detail: '',
			error: '',
			filename: '',
			complete: false,
			createdAt: this.#now(),
			finishedAt: 0,
			localDownloadRequestedAt: 0,
			artifact: null,
			controller: null,
			requestResumeCount: 0,
			challengeResumeCount: 0,
			resumeAvailable: false,
		};
		task.phase = 'queued';
		task.selection = selected;
		task.completed = resumeFromCheckpoint ? task.completed : 0;
		task.total = resumeFromCheckpoint ? task.total : 0;
		task.detail = resumeFromCheckpoint
			? task.total > 0
				? `正在从 ${Math.min(task.completed, task.total)}/${task.total} 楼断点继续`
				: '正在从已保存断点继续'
			: '';
		task.error = '';
		task.filename = '';
		task.complete = false;
		task.finishedAt = 0;
		task.artifact = null;
		task.requestResumeCount = 0;
		task.challengeResumeCount = 0;
		task.resumeAvailable = resumeFromCheckpoint;
		task.controller = new AbortController();
		this.#tasks.set(topicId, task);
		this.#trimTasks();
		this.#options.notify?.(resumeFromCheckpoint
			? `已从断点继续后台下载：${title}`
			: `已加入后台下载：${title}`);
		this.#scheduleRender();
		this.#tail = this.#tail.catch(() => {}).then(() => this.#run(task));
		return this.#taskSnapshot(task);
	}

	destroy(): void {
		this.scope.destroy();
	}

	async #run(task: ReaderTopicDownloadTask): Promise<void> {
		const controller = task.controller;
		if (!controller || controller.signal.aborted) return;
		try {
			while (true) {
				try {
					const artifact = await this.#options.worker(
						task.topicId,
						task.title,
						controller.signal,
						(progress) => {
							if (
								controller.signal.aborted ||
								task.controller !== controller
							) return;
							task.phase = progress.phase;
							if (progress.completed !== undefined) {
								task.completed = Math.max(0, Math.floor(progress.completed));
							}
							if (progress.total !== undefined) {
								task.total = Math.max(0, Math.floor(progress.total));
							}
							task.detail = String(progress.detail ?? '');
							this.#scheduleRender();
						},
						task.selection,
					);
					controller.signal.throwIfAborted();
					if (task.controller !== controller) return;
					task.artifact = artifact;
					task.filename = artifact.filename;
					task.completed = artifact.postCount;
					task.total = artifact.expectedPostCount;
					task.complete = artifact.complete;
					task.phase = 'ready';
					task.finishedAt = this.#now();
					task.detail = '';
					task.resumeAvailable = false;
					task.requestResumeCount = 0;
					task.challengeResumeCount = 0;
					try {
						await this.#backupArtifact(task, artifact);
						task.detail = '已保存到 Reader 下载历史 · 点击下载按钮可保存 HTML 到本地';
						this.#options.notify?.(
							`Topic #${task.topicId} 已保存到下载历史`,
						);
					} catch (error) {
						task.detail = `HTML 已生成，Reader 缓存备份失败 · ${String(
							(error as { readonly message?: unknown } | null)?.message ?? error,
						)}`;
						this.#options.notify?.(
							`Topic #${task.topicId} HTML 已生成，但 Reader 本地备份失败`,
						);
					}
					break;
				} catch (error) {
					if (task.controller !== controller) return;
					if (controller.signal.aborted) throw error;
					const resume = this.#options.requestResume?.(error) ?? null;
					if (!resume) throw error;
					const waitMs = resume.waitMs;
					task.resumeAvailable = true;
					if (resume.kind === 'cloudflare-challenge') {
						if (
							task.challengeResumeCount >=
								DOWNLOAD_CHALLENGE_AUTO_RESUME_LIMIT
						) throw error;
						task.challengeResumeCount += 1;
					} else {
						if (
							task.requestResumeCount >=
								DOWNLOAD_REQUEST_AUTO_RESUME_LIMIT
						) throw error;
						task.requestResumeCount += 1;
					}
					task.phase = resume.kind === 'cloudflare-challenge'
						? 'waiting-challenge'
						: 'waiting-rate-limit';
					task.error = '';
					const checkpoint = task.total > 0
						? `，已保存 ${Math.min(task.completed, task.total)}/${task.total} 楼断点`
						: '，已保存当前断点';
					if (resume.kind === 'cloudflare-challenge') {
						task.detail =
							`Cloudflare 验证未完成${checkpoint} · ` +
							'等待 Cloudflare 验证通过后自动续传';
						this.#options.notify?.(
							`Topic #${task.topicId} 已暂停下载并保存断点，` +
							'等待 Cloudflare 验证通过',
						);
					} else {
						const waitLabel = waitMs >= 1_000
							? `${Math.ceil(waitMs / 1_000)} 秒`
							: waitMs > 0 ? `${waitMs} 毫秒` : '立即';
						const resumeLabel = waitMs > 0 ? `${waitLabel}后` : waitLabel;
						task.detail =
							`遇到 HTTP 429${checkpoint} · ${resumeLabel}自动续传` +
							`（${task.requestResumeCount}/` +
							`${DOWNLOAD_REQUEST_AUTO_RESUME_LIMIT}）`;
						this.#options.notify?.(
							`Topic #${task.topicId} 遇到 429，已保存断点，` +
							`${resumeLabel}自动续传`,
						);
					}
					this.#scheduleRender();
					await resume.wait(controller.signal);
					controller.signal.throwIfAborted();
					if (task.controller !== controller) return;
					task.phase = 'queued';
					task.detail = task.total > 0
						? `正在从 ${Math.min(task.completed, task.total)}/${task.total} 楼断点继续`
						: '正在从已保存断点继续';
					this.#scheduleRender();
				}
			}
		} catch (error) {
			if (task.controller !== controller) return;
			if (controller.signal.aborted) {
				task.phase = 'cancelled';
				task.error = '';
			} else {
				task.phase = 'error';
				const resumable = this.#options.requestResume?.(error) ?? null;
				if (resumable && task.resumeAvailable) {
					if (resumable.kind === 'cloudflare-challenge') {
						task.error = task.challengeResumeCount >=
							DOWNLOAD_CHALLENGE_AUTO_RESUME_LIMIT
							? 'Cloudflare 验证后再次触发 · 已停止自动续传，断点已保存，可稍后继续下载'
							: 'Cloudflare 验证未完成 · 断点已保存，可继续下载';
					} else {
						task.error = task.requestResumeCount >=
							DOWNLOAD_REQUEST_AUTO_RESUME_LIMIT
							? 'HTTP 429 连续续传已达上限 · 断点已保存，可稍后继续下载'
							: 'HTTP 429 · 断点已保存，可继续下载';
					}
				} else {
					task.error = String(
						(error as { readonly message?: unknown } | null)?.message ?? error,
					);
				}
				this.#options.notify?.(
					`Topic #${task.topicId} 下载失败：${task.error}`,
				);
			}
			task.finishedAt = this.#now();
		} finally {
			if (task.controller === controller) task.controller = null;
			this.#scheduleRender();
		}
	}

	#click(event: Event): void {
		const target = eventElement(event)
			?.closest<HTMLElement>(
				'[data-topic-download-action],.ldp-topic-download-current,' +
					'.ldp-topic-download-close',
			) ?? null;
		if (!target) return;
		if (target === this.#closeManagerButton) {
			event.preventDefault();
			event.stopPropagation();
			this.closeManager();
			return;
		}
		if (target === this.#downloadCurrent) {
			this.enqueueCurrent();
			return;
		}
		const topicId = discourseTopicId(Number(target.dataset.topicId));
		const task = this.#tasks.get(topicId);
		if (!task) return;
		const action = target.dataset.topicDownloadAction;
		if (action === 'cancel') {
			task.controller?.abort(new DOMException('用户取消 Topic 下载', 'AbortError'));
			task.phase = 'cancelled';
			task.finishedAt = this.#now();
			this.#scheduleRender();
			return;
		}
		if (action === 'retry') {
			this.enqueue(task.topicId, task.title, task.selection);
			return;
		}
		if (action === 'remove') {
			void this.#confirmAndRemove(task);
			return;
		}
		if (action === 'save') {
			void this.#ensureArtifact(task)
				.then(() => this.#saveArtifact(task))
				.then(() => this.#options.notify?.(
					`Topic #${task.topicId} 已触发浏览器下载`,
				))
				.catch((error) => {
					this.#options.notify?.(
						`Topic #${task.topicId} HTML 保存失败：${String(error)}`,
					);
				});
			return;
		}
		if (action === 'view') {
			void this.#ensureArtifact(task).then(() => this.#view(task)).catch((error) => {
				this.#options.notify?.(
					`Topic #${task.topicId} 离线查看失败：${String(error)}`,
				);
			});
		}
	}

	async #saveArtifact(task: ReaderTopicDownloadTask): Promise<void> {
		if (!task.artifact) return Promise.resolve();
		await Promise.resolve(this.#options.downloads.save(
			new Blob([task.artifact.html], { type: 'text/html;charset=utf-8' }),
			task.artifact.filename,
		));
		task.localDownloadRequestedAt = this.#now();
		try {
			await this.#backupArtifact(task, task.artifact);
		} catch (error) {
			this.#options.notify?.(
				`Topic #${task.topicId} 已触发下载，但本地下载状态记录失败：${String(error)}`,
			);
		}
		this.#scheduleRender();
	}

	async #confirmAndRemove(task: ReaderTopicDownloadTask): Promise<void> {
		if (this.#removing.has(task.topicId)) return;
		this.#removing.add(task.topicId);
		try {
			const store = this.#options.artifacts;
			const hasCachedHtml = Boolean(await store?.read(task.topicId));
			const choice = await this.#options.confirmRemoval?.(
				Object.freeze({
					topicId: task.topicId,
					title: task.title,
					filename: task.filename,
					hasCachedHtml,
					localDownloadRequestedAt: task.localDownloadRequestedAt,
				}),
				this.#details,
			) ?? 'cancel';
			if (choice === 'cancel' || this.#tasks.get(task.topicId) !== task) return;
			if (choice === 'remove-record-and-cache') {
				await store?.remove(task.topicId);
			} else {
				await store?.remove(task.topicId, { preserveHtml: true });
			}
			task.controller?.abort(
				new DOMException('下载记录已移除', 'AbortError'),
			);
			this.#tasks.delete(task.topicId);
			this.#selectedHistoryTopics.delete(task.topicId);
			this.#options.notify?.(
				choice === 'remove-record-and-cache'
					? `Topic #${task.topicId} 下载记录与 Reader 缓存 HTML 已删除`
					: `Topic #${task.topicId} 下载记录已移除，Reader 缓存 HTML 已保留`,
			);
			this.#scheduleRender();
		} catch (error) {
			this.#options.notify?.(
				`Topic #${task.topicId} 下载记录移除失败：${String(error)}`,
			);
		} finally {
			this.#removing.delete(task.topicId);
		}
	}

	async #confirmAndRemoveSelected(): Promise<void> {
		const tasks = [...this.#selectedHistoryTopics]
			.map((topicId) => this.#tasks.get(topicId) ?? null)
			.filter((task): task is ReaderTopicDownloadTask => Boolean(task));
		if (!tasks.length || tasks.some((task) => this.#removing.has(task.topicId))) {
			return;
		}
		for (const task of tasks) this.#removing.add(task.topicId);
		try {
			const store = this.#options.artifacts;
			const contexts = await Promise.all(tasks.map(async (task) =>
				Object.freeze({
					topicId: task.topicId,
					title: task.title,
					filename: task.filename,
					hasCachedHtml: Boolean(await store?.read(task.topicId)),
					localDownloadRequestedAt: task.localDownloadRequestedAt,
				} satisfies ReaderTopicDownloadRemovalContext)));
			const choice = await this.#options.confirmBulkRemoval?.(
				Object.freeze(contexts),
				this.#details,
			) ?? 'cancel';
			if (choice === 'cancel') return;
			const activeTasks = tasks.filter((task) =>
				this.#tasks.get(task.topicId) === task);
			for (const task of activeTasks) {
				if (choice === 'remove-record-and-cache') {
					await store?.remove(task.topicId);
				} else {
					await store?.remove(task.topicId, { preserveHtml: true });
				}
				task.controller?.abort(
					new DOMException('下载记录已批量移除', 'AbortError'),
				);
				this.#tasks.delete(task.topicId);
				this.#selectedHistoryTopics.delete(task.topicId);
			}
			this.#options.notify?.(
				choice === 'remove-record-and-cache'
					? `已移除 ${activeTasks.length} 条下载记录及其 Reader 缓存 HTML`
					: `已移除 ${activeTasks.length} 条下载记录，Reader 缓存 HTML 已保留`,
			);
			this.#scheduleRender();
		} catch (error) {
			this.#options.notify?.(`Topic 下载记录批量移除失败：${String(error)}`);
		} finally {
			for (const task of tasks) this.#removing.delete(task.topicId);
		}
	}

	async #view(task: ReaderTopicDownloadTask): Promise<void> {
		if (!task.artifact) return;
		if (this.#options.viewHtml) {
			await this.#options.viewHtml(
				task.artifact.html,
				task.title,
				task.topicId,
			);
			return;
		}
		const view = this.#options.document.defaultView;
		const urlApi = view?.URL ?? globalThis.URL;
		if (!view || typeof urlApi.createObjectURL !== 'function') {
			throw new Error('当前浏览器不支持本地 HTML 新标签查看');
		}
		const objectUrl = urlApi.createObjectURL(new Blob(
			[prepareReaderTopicOfflineBlobHtml(
				task.artifact.html,
				this.#options.document,
			)],
			{ type: 'text/html;charset=utf-8' },
		));
		const retainedObjectUrl = Object.freeze({
			urlApi,
			value: objectUrl,
		});
		this.#viewObjectUrls.add(retainedObjectUrl);
		const popup = view.open(objectUrl, '_blank');
		if (!popup) {
			urlApi.revokeObjectURL(objectUrl);
			this.#viewObjectUrls.delete(retainedObjectUrl);
			throw new Error('浏览器阻止了离线 Topic 新标签页');
		}
		popup.opener = null;
		const hydrate = (): void => {
			try {
				this.#options.hydrateHtmlWindow?.(popup);
			} catch (error) {
				this.#options.notify?.(
					`Topic #${task.topicId} 离线正文水合失败：${String(error)}`,
				);
			}
		};
		if (typeof popup.addEventListener === 'function') {
			popup.addEventListener(
				'load',
				() => {
					hydrate();
				},
				{ once: true },
			);
		} else {
			hydrate();
		}
	}

	#queuePosition(): void {
		if (
			this.#positionFrame ||
			this.scope.destroyed ||
			!this.#options.floating ||
			!this.#managerVisible ||
			this.#details.hidden
		) return;
		let completed = false;
		const frame = this.#requestFrame(() => {
			completed = true;
			this.#positionFrame = 0;
			this.#positionFloating();
		});
		if (!completed) this.#positionFrame = frame;
	}

	#positionFloating(): void {
		if (this.#geometryCustomized || !this.windowGeometry) return;
		const anchor = this.#options.positionAnchor?.() ?? null;
		if (!anchor?.isConnected) return;
		const anchorRect = anchor.getBoundingClientRect();
		const geometry = this.windowGeometry.snapshot.geometry;
		const mountWidth = this.windowGeometry.snapshot.viewportWidth;
		const mountHeight = this.windowGeometry.snapshot.viewportHeight;
		const panelWidth = geometry.width;
		const panelHeight = geometry.height;
		const gap = 10;
		const inset = 8;
		const rightCandidate = anchorRect.right + gap;
		const leftCandidate = anchorRect.left - panelWidth - gap;
		const unclampedLeft = rightCandidate + panelWidth <= mountWidth - inset
			? rightCandidate
			: leftCandidate >= inset
				? leftCandidate
				: rightCandidate;
		const maximumLeft = Math.max(inset, mountWidth - panelWidth - inset);
		const left = Math.max(inset, Math.min(maximumLeft, unclampedLeft));
		const unclampedTop = anchorRect.top - inset;
		const maximumTop = Math.max(inset, mountHeight - panelHeight - inset);
		const top = Math.max(inset, Math.min(maximumTop, unclampedTop));
		this.windowGeometry.setGeometry(panelWidth, panelHeight, left, top);
	}

	#applyWindowGeometry(snapshot: ReaderWindowSnapshot): void {
		if (!this.#options.floating || !snapshot.managed) return;
		const geometry = snapshot.geometry;
		this.#details.style.left = `${geometry.left}px`;
		this.#details.style.top = `${geometry.top}px`;
		this.#details.style.width = `${geometry.width}px`;
		this.#details.style.height = `${geometry.height}px`;
	}

	#render(): void {
		this.#renderFrame = 0;
		this.syncCurrent();
		const tasks = [...this.#tasks.values()]
			.sort((left, right) => right.createdAt - left.createdAt);
		const query = this.#historySearch.value.trim().toLocaleLowerCase('zh-CN');
		const filteredTasks = query
			? tasks.filter((task) => [
				String(task.topicId),
				task.title,
				task.filename,
				selectionLabel(task.selection),
				phaseLabel(task),
			].join(' ').toLocaleLowerCase('zh-CN').includes(query))
			: tasks;
		const pageCount = Math.max(
			1,
			Math.ceil(filteredTasks.length / DOWNLOAD_HISTORY_PAGE_SIZE),
		);
		this.#historyPage = Math.min(this.#historyPage, pageCount - 1);
		const pageStart = this.#historyPage * DOWNLOAD_HISTORY_PAGE_SIZE;
		const pageTasks = filteredTasks.slice(
			pageStart,
			pageStart + DOWNLOAD_HISTORY_PAGE_SIZE,
		);
		this.#visibleHistoryTopicIds = Object.freeze(pageTasks.map((task) =>
			task.topicId));
		if (this.#options.floating) this.#details.hidden = !this.#managerVisible;
		const renderKey = JSON.stringify({
			current: this.#downloadCurrent.dataset.topicId,
			open: this.#managerOpen,
			query,
			page: this.#historyPage,
			batch: this.#historyBatchMode,
			selected: [...this.#selectedHistoryTopics].sort((left, right) =>
				Number(left) - Number(right)),
			tasks: tasks.map((task) => [
				task.topicId,
				task.phase,
				task.completed,
				task.total,
				task.detail,
				task.error,
				task.filename,
				task.selection.mode,
				task.selection.expression,
				task.localDownloadRequestedAt,
			]),
		});
		if (renderKey === this.#renderKey) {
			this.#queuePosition();
			return;
		}
		this.#renderKey = renderKey;
		const activeCount = tasks.filter((task) =>
			!['ready', 'error', 'cancelled'].includes(task.phase)).length;
		this.#summaryCount.textContent = activeCount
			? `${activeCount} 进行中`
			: tasks.length ? String(tasks.length) : '';
		this.#historyCount.textContent = query
			? `${filteredTasks.length} / ${tasks.length} 条`
			: `${tasks.length} 条`;
		this.#historyBatchToggle.setAttribute(
			'aria-pressed',
			String(this.#historyBatchMode),
		);
		this.#historyBatchToggle.setAttribute(
			'aria-label',
			this.#historyBatchMode ? '退出批量管理' : '进入批量管理',
		);
		this.#historyBatchToggle.querySelector('span')!.textContent =
			this.#historyBatchMode ? '完成' : '批量管理';
		this.#historyBatchBar.hidden = !this.#historyBatchMode;
		const allPageSelected = pageTasks.length > 0 && pageTasks.every((task) =>
			this.#selectedHistoryTopics.has(task.topicId));
		this.#historySelectPage.disabled = pageTasks.length === 0;
		this.#historySelectPage.setAttribute(
			'aria-label',
			allPageSelected ? '取消选择当前页' : '选择当前页',
		);
		this.#historySelectPage.querySelector('span')!.textContent =
			allPageSelected ? '取消本页' : '全选本页';
		this.#historySelectionCount.textContent =
			`已选 ${this.#selectedHistoryTopics.size} 条`;
		this.#historyRemoveSelected.disabled =
			this.#selectedHistoryTopics.size === 0;
		this.#list.replaceChildren(...pageTasks.map((task) => this.#row(task)));
		if (!pageTasks.length) {
			const empty = node(this.#options.document, 'p', 'ldp-topic-download-empty');
			empty.textContent = tasks.length
				? '没有匹配的下载记录。'
				: '还没有下载任务。';
			this.#list.append(empty);
		}
		this.#historyPagination.hidden = filteredTasks.length <=
			DOWNLOAD_HISTORY_PAGE_SIZE;
		this.#historyPageLabel.textContent =
			`第 ${this.#historyPage + 1} / ${pageCount} 页`;
		this.#historyPagePrevious.disabled = this.#historyPage === 0;
		this.#historyPageNext.disabled = this.#historyPage >= pageCount - 1;
		this.#queuePosition();
		this.#emit();
	}

	async #restoreArtifacts(): Promise<void> {
		const store = this.#options.artifacts;
		if (!store || this.scope.destroyed) return;
		try {
			for (const entry of await store.list()) {
				const topicId = discourseTopicId(entry.topicId);
				if (this.scope.destroyed || this.#tasks.has(topicId)) continue;
				this.#tasks.set(topicId, {
					topicId,
					title: entry.title,
					selection: restoredSelection(entry),
					phase: 'ready',
					completed: entry.postCount,
					total: entry.expectedPostCount,
					detail: '已从 Reader 本地备份恢复',
					error: '',
					filename: entry.filename,
					complete: entry.complete,
					createdAt: entry.createdAt,
					finishedAt: entry.finishedAt,
					localDownloadRequestedAt:
						Math.max(0, Number(entry.localDownloadRequestedAt) || 0),
					artifact: null,
						controller: null,
						requestResumeCount: 0,
						challengeResumeCount: 0,
						resumeAvailable: false,
				});
			}
			this.#trimTasks();
			this.#scheduleRender();
		} catch (error) {
			this.#options.notify?.(`Topic 下载历史读取失败：${String(error)}`);
		}
	}

	async #ensureArtifact(task: ReaderTopicDownloadTask): Promise<void> {
		if (task.artifact) return;
		const cached = await this.#options.artifacts?.read(task.topicId) ?? null;
		if (!cached) throw new Error('Reader 本地 HTML 备份已不可用');
		task.artifact = Object.freeze({
			html: cached.html,
			filename: cached.filename,
			postCount: cached.postCount,
			expectedPostCount: cached.expectedPostCount,
			complete: cached.complete,
		});
	}

	#backupArtifact(
		task: ReaderTopicDownloadTask,
		artifact: ReaderTopicDownloadArtifact,
	): Promise<void> {
		const store = this.#options.artifacts;
		if (!store) return Promise.resolve();
		const record: ReaderTopicOfflineArtifactRecord = Object.freeze({
			topicId: task.topicId,
			title: task.title,
			selectionMode: task.selection.mode,
			selectionExpression: task.selection.expression,
			...artifact,
			createdAt: task.createdAt,
			finishedAt: task.finishedAt,
			localDownloadRequestedAt: task.localDownloadRequestedAt,
		});
		return store.write(record);
	}

	#row(task: ReaderTopicDownloadTask): HTMLElement {
		const document = this.#options.document;
		const row = node(document, 'article', 'ldp-topic-download-task');
		row.classList.add(`is-${task.phase}`);
		row.dataset.topicId = String(task.topicId);
		if (this.#historyBatchMode) {
			row.classList.add('is-batch');
			const selectionLabelNode = node(
				document,
				'label',
				'ldp-topic-download-task-selection',
			);
			const selectionInput = document.createElement('input');
			selectionInput.type = 'checkbox';
			selectionInput.checked = this.#selectedHistoryTopics.has(task.topicId);
			selectionInput.dataset.topicDownloadSelect = '';
			selectionInput.dataset.topicId = String(task.topicId);
			selectionInput.setAttribute(
				'aria-label',
				`选择 Topic #${task.topicId}：${task.title}`,
			);
			selectionLabelNode.append(selectionInput);
			row.append(selectionLabelNode);
		}
		const copy = node(document, 'span', 'ldp-topic-download-task-copy');
		const title = node(document, 'strong');
		title.textContent = task.title;
		const state = node(document, 'small');
		state.textContent = phaseLabel(task);
		copy.append(title, state);
		if (
			['loading-posts', 'loading-replies', 'waiting-rate-limit', 'waiting-challenge']
				.includes(task.phase) &&
			task.total > 0
		) {
			const progress = node(document, 'progress') as HTMLProgressElement;
			progress.max = task.total;
			progress.value = Math.min(task.total, task.completed);
			progress.setAttribute('aria-label', phaseLabel(task));
			copy.append(progress);
		}
		const actions = node(document, 'span', 'ldp-topic-download-task-actions');
		const addAction = (action: string, label: string, iconName: string): void => {
			const actionButton = button(
				document,
				`ldp-topic-download-${action}`,
				label,
				iconName,
			);
			actionButton.dataset.topicDownloadAction = action;
			actionButton.dataset.topicId = String(task.topicId);
			actions.append(actionButton);
		};
		if (task.phase === 'ready') {
			addAction('view', '查看离线 Topic', 'external-link');
			addAction('save', '下载 HTML 到本地', 'download');
			addAction('remove', '移除下载记录', 'x');
		} else if (task.phase === 'error' || task.phase === 'cancelled') {
			addAction(
				'retry',
				task.resumeAvailable ? '继续下载' : '重试下载',
				'rotate-ccw',
			);
			addAction('remove', '移除下载记录', 'x');
		} else {
			addAction('cancel', '取消后台下载', 'x');
		}
		row.append(copy, actions);
		return row;
	}

	#taskSnapshot(task: ReaderTopicDownloadTask): ReaderTopicDownloadTaskSnapshot {
		return Object.freeze({
			topicId: task.topicId,
			title: task.title,
			selection: task.selection,
			phase: task.phase,
			completed: task.completed,
			total: task.total,
			detail: task.detail,
			error: task.error,
			filename: task.filename,
			complete: task.complete,
			createdAt: task.createdAt,
			finishedAt: task.finishedAt,
			localDownloadRequestedAt: task.localDownloadRequestedAt,
		});
	}

	#scheduleRender(): void {
		if (this.scope.destroyed || this.#renderFrame) return;
		let completed = false;
		const frame = this.#requestFrame(() => {
			completed = true;
			this.#render();
		});
		if (!completed) this.#renderFrame = frame;
	}

	#trimTasks(): void {
		const disposable = [...this.#tasks.values()]
			.filter((task) => ['error', 'cancelled'].includes(task.phase))
			.sort((left, right) => right.createdAt - left.createdAt);
		for (const task of disposable.slice(20)) {
			this.#tasks.delete(task.topicId);
			this.#selectedHistoryTopics.delete(task.topicId);
		}
	}

	#emit(): void {
		for (const error of this.changes.emit(this.snapshot())) {
			this.#options.notify?.(`Topic 下载管理更新失败：${String(error)}`);
		}
	}
}
