import type {
	TopicLocalArchiveState,
} from '../cache/topic-snapshot-repository.js';
import type {
	DiscourseTopicPayload,
	DiscourseTopicPostInput,
} from '../topic/topic-session.js';
import type {
	ReaderTopicHeaderSnapshot,
} from '../topic/reader-topic-header.js';
import {
	hasReaderIcon,
	readerIconSvgMarkup,
} from '../components/reader-icon.js';
import {
	normalizeReaderTranslationTheme,
	type ReaderTranslationTheme,
} from '../translation/reader-translation-presentation.js';

export interface ReaderTopicOfflineQuotedPost<
	TPost extends DiscourseTopicPostInput,
> {
	readonly topicId: number;
	readonly post: TPost;
}

export interface ReaderTopicOfflineQuoteTarget {
	readonly topicId: number;
	readonly postNumber: number;
}

/** 把同一 Topic 上次命中的原生 endpoint 提到首位，同时保留完整 fallback。 */
export function prioritizeReaderTopicOfflineTargetCandidates<
	TCandidate extends Readonly<{ readonly endpoint: string }>,
>(
	candidates: readonly TCandidate[],
	preferredEndpoint?: string,
): readonly TCandidate[] {
	const preferred = String(preferredEndpoint ?? '').trim();
	const preferredIndex = preferred
		? candidates.findIndex((candidate) => candidate.endpoint === preferred)
		: -1;
	if (preferredIndex <= 0) return Object.freeze([...candidates]);
	return Object.freeze([
		candidates[preferredIndex]!,
		...candidates.slice(0, preferredIndex),
		...candidates.slice(preferredIndex + 1),
	]);
}

export interface ReaderTopicOfflineDocumentInput<
	TTopic extends DiscourseTopicPayload<TPost>,
	TPost extends DiscourseTopicPostInput,
> {
	readonly topicId: number;
	readonly title: string;
	readonly sourceUrl: string;
	readonly topic: TTopic;
	/** 省略时显示全部正文；提供时以这些楼层为主流锚点，正文集合仍保留讨论上下文。 */
	readonly mainPostNumbers?: readonly number[];
	readonly projectionMode?: 'op' | 'custom';
	readonly posts: readonly TPost[];
	/** 当前正文直接引用、且不属于主 Topic 正文集合的完整楼层快照。 */
	readonly quotedPosts?: readonly ReaderTopicOfflineQuotedPost<TPost>[];
	readonly expectedPostCount: number;
	readonly complete: boolean;
	readonly archive: TopicLocalArchiveState;
	/** 与在线 Reader 当前设置一致；仅控制离线 HTML 的初始内联深度。 */
	readonly inlineReplyTreeMaxDepth?: number;
	readonly header?: ReaderTopicHeaderSnapshot;
	readonly siteLogoUrl?: string;
	/** 下载时解析正文实际使用的回应表情；URL 会固化到离线 HTML。 */
	readonly reactionEmojiUrl?: (reactionId: string) => string;
	/** 下载时解析所有可见文本字段中的 `:shortcode:`；URL 会固化到离线 HTML。 */
	readonly inlineEmojiUrl?: (emojiId: string) => string;
	/** 固化下载时 Reader 已投影的阅读外观；不包含窗口位置或在线工作区几何。 */
	readonly presentation?: Readonly<{
		readonly theme?: 'light' | 'dark';
		readonly translationMode?: 'original' | 'bilingual' | 'translation';
		readonly translationTheme?: ReaderTranslationTheme;
		readonly styleProperties?: Readonly<Record<string, string>>;
		readonly structureColorsDisabled?: boolean;
	}>;
	readonly stylesheet: string;
	readonly generatedAt?: number;
	/** 下载时复用在线 Reader 的纯 DOM 正文增强（如 Callout、KaTeX）。 */
	readonly prepareCooked?: (cooked: string) => string;
}

export interface ReaderTopicOfflineDocument {
	readonly html: string;
	readonly filename: string;
	readonly postCount: number;
	readonly expectedPostCount: number;
	readonly complete: boolean;
}

const OFFLINE_RUNTIME_SCRIPT_OPEN =
	'<script id="ldp-offline-topic-runtime">';

/**
 * Blob 文档继承创建页面的 CSP；查看时只给临时副本补当前 nonce，永久存档
 * 与下载到磁盘的 HTML 保持无页面会话信息、可独立执行。
 */
export function prepareReaderTopicOfflineBlobHtml(
	html: string,
	sourceDocument: Document,
): string {
	const nonce = [...sourceDocument.querySelectorAll<HTMLScriptElement>(
		'script[nonce]',
	)].map((script) => String(script.nonce || script.getAttribute('nonce') || ''))
		.find(Boolean) ?? '';
	if (!nonce || !html.includes(OFFLINE_RUNTIME_SCRIPT_OPEN)) return html;
	return html.replace(
		OFFLINE_RUNTIME_SCRIPT_OPEN,
		`<script id="ldp-offline-topic-runtime" nonce="${htmlText(nonce)}">`,
	);
}

interface ReaderOfflinePost {
	readonly [key: string]: unknown;
	readonly id: number;
	readonly post_number: number;
	readonly username: string;
	readonly name: string;
	readonly avatar_template: string;
	readonly created_at: string;
	readonly updated_at: string;
	readonly reply_to_post_number: number | null;
	readonly hidden: boolean;
	readonly cooked: string;
	readonly offline_estimated_size: number;
	readonly offline_search_text: string;
}

interface ReaderTopicOfflineRuntimeEnvironment {
	readonly document: Document;
	readonly window: Window;
	readonly location: Location;
	readonly URL: typeof globalThis.URL;
	readonly requestAnimationFrame: (callback: FrameRequestCallback) => number;
	readonly cancelAnimationFrame: (handle: number) => void;
}

type OfflineArchiveReasonSource = Readonly<Record<string, unknown>>;

function localArchiveReason(value: unknown): string {
	if (!value || typeof value !== 'object') return '';
	const record = value as OfflineArchiveReasonSource;
	for (const key of [
		'unavailable_reason',
		'deleted_reason',
		'hidden_reason',
		'removal_reason',
		'reason',
	]) {
		const reason = String(record[key] ?? '').replace(/\s+/g, ' ').trim();
		if (reason) return reason.slice(0, 240);
	}
	if (record.hidden === true) return '该内容已被隐藏';
	if (record.deleted_at || record.deletedAt) return '该内容已被删除';
	return '';
}

function localArchiveStatusLabel(statusValue: unknown): string {
	const status = Number(statusValue);
	if (status === 403) return '已隐藏或无权访问（403）';
	if (status === 410) return '已删除（410）';
	return '已删除、隐藏或不可用（404）';
}

function absoluteDocumentUrl(value: unknown, baseUrl: string): string {
	const source = String(value ?? '').trim();
	if (!source) return '';
	try {
		return new URL(source, baseUrl).href;
	} catch {
		return source;
	}
}

function safeFilename(value: string): string {
	const name = String(value)
		.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
		.replace(/\s+/g, ' ')
		.replace(/[.\s]+$/g, '')
		.trim()
		.slice(0, 160);
	return name || 'topic';
}

function htmlText(value: unknown): string {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function serializedJson(value: unknown): string {
	return JSON.stringify(value)
		.replace(/</g, '\\u003c')
		.replace(/-->/g, '--\\u003e')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');
}

function estimatedOfflinePostSize(cooked: string): number {
	const textLength = cooked.replace(/<[^>]*>/g, ' ').length;
	const mediaCount = (cooked.match(/<(?:img|video|iframe)\b/gi) ?? []).length;
	const codeLines = (cooked.match(/\n/g) ?? []).length;
	return Math.max(150, Math.min(
		2_400,
		150 + Math.ceil(textLength / 88) * 23 +
			Math.min(4, mediaCount) * 220 + Math.min(20, codeLines) * 12,
	));
}

function offlinePostSearchText(cooked: string): string {
	const namedEntities: Readonly<Record<string, string>> = Object.freeze({
		amp: '&',
		apos: "'",
		gt: '>',
		lt: '<',
		nbsp: ' ',
		quot: '"',
	});
	return cooked
		.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(/<[^>]*>/g, ' ')
		.replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, value: string) => {
			const numeric = value.toLowerCase().startsWith('x')
				? Number.parseInt(value.slice(1), 16)
				: Number.parseInt(value, 10);
			return Number.isSafeInteger(numeric) && numeric > 0 && numeric <= 0x10ffff
				? String.fromCodePoint(numeric)
				: entity;
		})
		.replace(/&([a-z]+);/gi, (entity, name: string) =>
			namedEntities[name.toLowerCase()] ?? entity)
		.replace(/\s+/g, ' ')
		.trim();
}

function offlinePost(
	value: DiscourseTopicPostInput & Readonly<Record<string, unknown>>,
	prepareCooked: (cooked: string) => string = (cooked) => cooked,
): ReaderOfflinePost | null {
	const postNumber = Number(value.post_number);
	if (!Number.isSafeInteger(postNumber) || postNumber < 1) return null;
	const postId = Number(value.id);
	const replyTo = Number(value.reply_to_post_number);
	const cooked = prepareCooked(String(value.cooked ?? ''));
	const prepareNested = (candidate: unknown): unknown => {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
			return candidate;
		}
		const record = candidate as Readonly<Record<string, unknown>>;
		return Object.freeze({
			...record,
			...(typeof record.cooked === 'string'
				? { cooked: prepareCooked(record.cooked) }
				: {}),
		});
	};
	const boosts = Array.isArray(value.boosts)
		? Object.freeze(value.boosts.map(prepareNested))
		: value.boosts && typeof value.boosts === 'object'
			? prepareNested(value.boosts)
			: value.boosts;
	const votingComments = Array.isArray(value.post_voting_comments)
		? Object.freeze(value.post_voting_comments.map(prepareNested))
		: value.post_voting_comments;
	const comments = Array.isArray(value.comments)
		? Object.freeze(value.comments.map(prepareNested))
		: value.comments;
	return Object.freeze({
		...value,
		...(boosts === undefined ? {} : { boosts }),
		...(votingComments === undefined
			? {}
			: { post_voting_comments: votingComments }),
		...(comments === undefined ? {} : { comments }),
		id: Number.isSafeInteger(postId) && postId > 0 ? postId : postNumber,
		post_number: postNumber,
		username: String(value.username ?? ''),
		name: String(value.name ?? ''),
		avatar_template: String(value.avatar_template ?? ''),
		created_at: String(value.created_at ?? ''),
		updated_at: String(value.updated_at ?? ''),
		reply_to_post_number:
			Number.isSafeInteger(replyTo) && replyTo > 0 ? replyTo : null,
		hidden: value.hidden === true,
		cooked,
		offline_estimated_size: estimatedOfflinePostSize(cooked),
		offline_search_text: offlinePostSearchText(cooked),
	});
}

function offlineReactionIds(
	posts: readonly ReaderOfflinePost[],
): readonly string[] {
	const ids = new Set<string>();
	for (const post of posts) {
		let hasReaction = false;
		for (const value of Array.isArray(post.reactions) ? post.reactions : []) {
			if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
			const source = value as Readonly<Record<string, unknown>>;
			const id = String(source.id ?? '').trim().replace(/^:+|:+$/g, '');
			if (!id || Math.max(0, Number(source.count) || 0) < 1) continue;
			ids.add(id);
			hasReaction = true;
		}
		if (hasReaction) continue;
		const like = (Array.isArray(post.actions_summary)
			? post.actions_summary
			: []).find((value) => {
				if (!value || typeof value !== 'object' || Array.isArray(value)) {
					return false;
				}
				const source = value as Readonly<Record<string, unknown>>;
				return Number(source.id) === 2 || Number(source.action_type_id) === 2;
			});
		if (
			like && typeof like === 'object' && !Array.isArray(like) &&
			Math.max(
				0,
				Number((like as Readonly<Record<string, unknown>>).count) || 0,
			) > 0
		) ids.add('heart');
	}
	return Object.freeze([...ids]);
}

function offlineReactionEmojiSources(
	posts: readonly ReaderOfflinePost[],
	sourceUrl: string,
	resolve: ((reactionId: string) => string) | undefined,
): Readonly<Record<string, string>> {
	const sources = Object.create(null) as Record<string, string>;
	if (!resolve) return Object.freeze(sources);
	for (const id of offlineReactionIds(posts)) {
		try {
			const source = absoluteDocumentUrl(resolve(id), sourceUrl);
			if (source) sources[id] = source;
		} catch {
			// 单个宿主表情解析失败时保留可访问文本，不阻断整篇离线导出。
		}
	}
	return Object.freeze(sources);
}

function offlineInlineEmojiSources(
	values: readonly unknown[],
	sourceUrl: string,
	resolve: ((emojiId: string) => string) | undefined,
): Readonly<Record<string, string>> {
	const sources = Object.create(null) as Record<string, string>;
	if (!resolve) return Object.freeze(sources);
	const ids = new Set<string>();
	const seen = new WeakSet<object>();
	const visit = (value: unknown): void => {
		if (typeof value === 'string') {
			for (const match of value.matchAll(/:([a-z0-9_+\-]+):/giu)) {
				const id = String(match[1] ?? '').trim();
				if (id) ids.add(id);
			}
			return;
		}
		if (!value || typeof value !== 'object' || seen.has(value)) return;
		seen.add(value);
		if (Array.isArray(value)) value.forEach(visit);
		else Object.values(value as Readonly<Record<string, unknown>>).forEach(visit);
	};
	values.forEach(visit);
	for (const id of ids) {
		try {
			const source = absoluteDocumentUrl(resolve(id), sourceUrl);
			if (source) sources[id] = source;
		} catch {
			// 单个短码解析失败时保留原文字段，不阻断整篇离线导出。
		}
	}
	return Object.freeze(sources);
}

/** 从 cooked 引用卡片中提取需要随下载补齐的唯一目标楼层。 */
export function readerTopicOfflineQuoteTargets<
	TPost extends DiscourseTopicPostInput,
>(
	document: Document,
	currentTopicIdValue: number,
	posts: readonly TPost[],
): readonly ReaderTopicOfflineQuoteTarget[] {
	const currentTopicId = Number(currentTopicIdValue);
	if (!Number.isSafeInteger(currentTopicId) || currentTopicId < 1) return Object.freeze([]);
	const targets = new Map<string, ReaderTopicOfflineQuoteTarget>();
	const template = document.createElement('template');
	for (const post of posts) {
		template.innerHTML = String(
			(post as Readonly<Record<string, unknown>>).cooked ?? '',
		);
		for (const quote of template.content.querySelectorAll<HTMLElement>(
			'aside.quote[data-post]',
		)) {
			const topicId = Number(quote.dataset.topic ?? currentTopicId);
			const postNumber = Number(quote.dataset.post);
			if (
				!Number.isSafeInteger(topicId) || topicId < 1 ||
				!Number.isSafeInteger(postNumber) || postNumber < 1
			) continue;
			const key = `${topicId}:${postNumber}`;
			if (!targets.has(key)) {
				targets.set(key, Object.freeze({ topicId, postNumber }));
			}
		}
	}
	return Object.freeze([...targets.values()].sort((left, right) =>
		left.topicId - right.topicId || left.postNumber - right.postNumber));
}

function solvedAnswerPostNumbers(
	topic: Readonly<Record<string, unknown>>,
	posts: readonly ReaderOfflinePost[],
	availablePostNumbers: ReadonlySet<number>,
): readonly number[] {
	const candidates: number[] = posts
		.filter((post) => post.accepted_answer === true)
		.map((post) => post.post_number);
	const append = (value: unknown): void => {
		if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
			const record = value as Readonly<Record<string, unknown>>;
			candidates.push(Number(
				record.post_number ?? record.accepted_answer_post_number,
			));
			return;
		}
		candidates.push(Number(value));
	};
	if (Array.isArray(topic.accepted_answers)) {
		topic.accepted_answers.forEach(append);
	}
	append(topic.accepted_answer);
	append(topic.accepted_answer_post_number);
	return Object.freeze([...new Set(candidates.filter((postNumber) =>
		Number.isSafeInteger(postNumber) && postNumber > 1 &&
		availablePostNumbers.has(postNumber),
	))].sort((left, right) => left - right));
}

function offlineReaderStyle(
	properties: Readonly<Record<string, string>> | undefined,
): string {
	if (!properties) return '';
	return Object.entries(properties)
		.filter(([name, value]) =>
			/^--(?:ldp-[a-z0-9-]+|tertiary(?:-low)?|d-link-color)$/.test(name) &&
			!name.startsWith('--ldp-reader-window-') &&
			!name.startsWith('--ldp-reader-workspace-') &&
			String(value).trim().length > 0)
		.map(([name, value]) => `${name}:${String(value).trim()}`)
		.join(';');
}

/* 作为字符串内联进导出 HTML；不得捕获 Reader 运行时对象。 */
function readerTopicOfflineRuntime(
	environment: ReaderTopicOfflineRuntimeEnvironment =
		globalThis as unknown as ReaderTopicOfflineRuntimeEnvironment,
): void {
	const {
		document,
		window,
		location,
		URL,
		requestAnimationFrame,
		cancelAnimationFrame,
	} = environment;
	type OfflinePost = Record<string, unknown>;
	type OfflineArchiveEntry = {
		readonly postNumber?: unknown;
		readonly status?: unknown;
		readonly confirmedAt?: unknown;
		readonly reason?: unknown;
	};
	type OfflineQuotedPost = {
		readonly topicId?: unknown;
		readonly post?: OfflinePost;
	};
	type OfflineEntry = {
		readonly postNumber: number;
		readonly parentPostNumber: number | null;
		readonly depth: number;
		subtreeEndIndex: number;
	};
	type OfflineProjectionGraph = {
		readonly parentByNumber: Map<number, number | null>;
		readonly childrenByNumber: Map<number, number[]>;
		readonly entries: OfflineEntry[];
		readonly indexByPost: Map<number, number>;
	};
	type OfflineView = {
		readonly postNumber: number;
		readonly root: HTMLElement;
		readonly header: HTMLElement;
		readonly body: HTMLElement;
		readonly content: HTMLElement;
		readonly bodyLayer: HTMLElement;
		readonly replyTree: HTMLElement;
		readonly replyList: HTMLElement;
		readonly replyControls: HTMLElement;
		readonly branchToggle: HTMLButtonElement | null;
		readonly branchDiscussion: HTMLButtonElement | null;
		readonly contextDiscussion: HTMLButtonElement | null;
		hydrated: boolean;
	};
	type OfflineSearchRecord = {
		readonly postNumber: number;
		readonly postId: number;
		readonly username: string;
		readonly name: string;
		readonly bodyText: string;
		readonly normalizedBodyText: string;
		readonly searchText: string;
		readonly compactSearchText: string;
	};
	type OfflineWindowRange = {
		readonly start: number;
		readonly end: number;
		readonly visibleStart: number;
		readonly visibleEnd: number;
	};
	type OfflineIdleDeadline = {
		readonly didTimeout: boolean;
		timeRemaining(): number;
	};
	type OfflineIdleWindow = Window & {
		requestIdleCallback?: (
			callback: (deadline: OfflineIdleDeadline) => void,
			options?: { readonly timeout: number },
		) => number;
		cancelIdleCallback?: (handle: number) => void;
	};

	const dataNode = document.getElementById('ldp-offline-topic-data');
	const viewport = document.getElementById('ldp-offline-viewport');
	const list = document.getElementById('ldp-offline-posts');
	const before = document.getElementById('ldp-offline-before');
	const after = document.getElementById('ldp-offline-after');
	const status = document.getElementById('ldp-offline-status');
	const offlineReader = document.querySelector<HTMLElement>('[data-offline-reader]');
	if (
		!dataNode || !viewport || !list || !before || !after || !status ||
		!offlineReader || offlineReader.dataset.offlineHydrated === '1'
	) return;
	const searchForm = document.querySelector<HTMLFormElement>(
		'#ldp-offline-search-form',
	);
	const searchInput = document.querySelector<HTMLInputElement>(
		'#ldp-offline-search-input',
	);
	const searchClear = document.querySelector<HTMLButtonElement>(
		'#ldp-offline-search-clear',
	);
	const searchResults = document.querySelector<HTMLElement>(
		'#ldp-offline-search-results',
	);
	const onlyOpToggle = document.querySelector<HTMLButtonElement>(
		'#ldp-offline-only-op',
	);
	const jumpForm = document.querySelector<HTMLFormElement>(
		'#ldp-offline-jump-form',
	);
	const jumpInput = document.querySelector<HTMLInputElement>(
		'#ldp-offline-jump-input',
	);
	const toolStatus = document.querySelector<HTMLElement>(
		'#ldp-offline-tool-status',
	);
	const exactTimeTooltip = document.createElement('div');
	exactTimeTooltip.className =
		'ldp-reader-icon-tooltip ldp-reader-time-tooltip ldp-transient-surface';
	exactTimeTooltip.setAttribute('role', 'tooltip');
	exactTimeTooltip.hidden = true;
	offlineReader.append(exactTimeTooltip);

	const data = JSON.parse(dataNode.textContent || '{}');
	const posts = (Array.isArray(data.posts) ? data.posts : [])
		.filter((post: OfflinePost) => {
			const postNumber = Number(post.post_number);
			return Number.isSafeInteger(postNumber) && postNumber > 0;
		})
		.sort((left: OfflinePost, right: OfflinePost) =>
			Number(left.post_number) - Number(right.post_number));
	const postByNumber = new Map<number, OfflinePost>(posts.map(
		(post: OfflinePost) => [Number(post.post_number), post],
	));
	const quotedPostByKey = new Map<string, OfflinePost>();
	for (const entry of Array.isArray(data.quotedPosts)
		? data.quotedPosts as OfflineQuotedPost[]
		: []) {
		const topicId = Number(entry.topicId);
		const postNumber = Number(entry.post?.post_number);
		if (
			!Number.isSafeInteger(topicId) || topicId < 1 ||
			!Number.isSafeInteger(postNumber) || postNumber < 1 || !entry.post
		) continue;
		quotedPostByKey.set(`${topicId}:${postNumber}`, entry.post);
	}
	const quotedPost = (topicId: number, postNumber: number): OfflinePost | null =>
		(topicId === Number(data.topicId)
			? postByNumber.get(postNumber)
			: undefined) ?? quotedPostByKey.get(`${topicId}:${postNumber}`) ?? null;
	const solvedAnswerPostNumbers = Array.isArray(data.solvedAnswerPostNumbers)
		? [...new Set<number>(data.solvedAnswerPostNumbers.map(Number).filter(
			(postNumber: number) => Number.isSafeInteger(postNumber) &&
				postNumber > 1 && postByNumber.has(postNumber),
		))].sort((left, right) => left - right)
		: [];
	const requestedMainPostNumbers = Array.isArray(data.mainPostNumbers)
		? [...new Set<number>(data.mainPostNumbers.map(Number).filter(
			(postNumber: number) =>
				Number.isSafeInteger(postNumber) && postNumber > 0 &&
				postByNumber.has(postNumber),
		))].sort((left, right) => left - right)
		: [];
	const downloadedProjectionMode = String(data.projectionMode) === 'custom'
		? 'custom'
		: 'all';
	const downloadedMainPostNumbers = downloadedProjectionMode === 'custom' &&
		requestedMainPostNumbers.length > 0
		? requestedMainPostNumbers
		: null;
	const inlineReplyTreeMaxDepth = Math.min(
		5,
		Math.max(1, Math.trunc(Number(data.inlineReplyTreeMaxDepth) || 3)),
	);
	const postVotingEnabled = data.postVoting === true;
	const unavailable = new Map<number, OfflineArchiveEntry>(
		(Array.isArray(data.archive?.posts) ? data.archive.posts : [])
			.map((entry: OfflineArchiveEntry) => [Number(entry.postNumber), entry]),
	);
	const candidateParent = (postNumber: number): number | null => {
		const replyTo = Number(postByNumber.get(postNumber)?.reply_to_post_number);
		return Number.isSafeInteger(replyTo) && replyTo > 0 &&
			replyTo !== postNumber && postByNumber.has(replyTo)
			? replyTo
			: null;
	};
	const canonicalParentByNumber = new Map<number, number | null>();
	for (const postNumber of postByNumber.keys()) {
		const parent = candidateParent(postNumber);
		if (parent === null) {
			canonicalParentByNumber.set(postNumber, null);
			continue;
		}
		const seen = new Set<number>([postNumber]);
		let cursor: number | null = parent;
		let cyclic = false;
		while (cursor !== null) {
			if (seen.has(cursor)) {
				cyclic = true;
				break;
			}
			seen.add(cursor);
			cursor = candidateParent(cursor);
		}
		canonicalParentByNumber.set(postNumber, cyclic ? null : parent);
	}
	const canonicalDepthByNumber = new Map<number, number>();
	for (const postNumber of postByNumber.keys()) {
		const path: number[] = [];
		let cursor = postNumber;
		while (!canonicalDepthByNumber.has(cursor)) {
			path.push(cursor);
			const parent = canonicalParentByNumber.get(cursor) ?? null;
			if (parent === null) {
				canonicalDepthByNumber.set(cursor, 0);
				path.pop();
				break;
			}
			cursor = parent;
		}
		let depth = canonicalDepthByNumber.get(cursor) ?? 0;
		for (let index = path.length - 1; index >= 0; index -= 1) {
			depth += 1;
			canonicalDepthByNumber.set(path[index]!, depth);
		}
	}
	const canonicalChildrenByNumber = new Map<number, number[]>();
	for (const [postNumber, parentPostNumber] of canonicalParentByNumber) {
		if (parentPostNumber === null) continue;
		const children = canonicalChildrenByNumber.get(parentPostNumber) ?? [];
		children.push(postNumber);
		canonicalChildrenByNumber.set(parentPostNumber, children);
	}
	for (const children of canonicalChildrenByNumber.values()) {
		children.sort((left, right) => left - right);
	}
	const ownerUsername = String(
		data.ownerUsername || postByNumber.get(1)?.username || '',
	).trim();
	const ownerUsernameKey = ownerUsername.toLocaleLowerCase();
	const onlyOpPostNumbers = Object.freeze(posts.filter((post: OfflinePost) =>
		ownerUsernameKey &&
		String(post.username || '').toLocaleLowerCase() === ownerUsernameKey
	).map((post: OfflinePost) => Number(post.post_number)));
	let onlyOpActive = String(data.projectionMode) === 'op' &&
		onlyOpPostNumbers.length > 0;
	let activeProjectionMode: 'all' | 'custom' | 'op' = onlyOpActive
		? 'op'
		: downloadedProjectionMode;
	let activeMainPostNumbers: readonly number[] | null = onlyOpActive
		? onlyOpPostNumbers
		: downloadedMainPostNumbers;
	let selectedProjection = activeMainPostNumbers !== null;
	/*
	 * 全量模式保留 canonical 父子关系；筛选模式把命中的楼层投影为主流根节点，
	 * 完整正文仍留在 postByNumber，搜索或楼层跳转可随时打开讨论上下文。
	 */
	const createProjectionGraph = (
		mainPostNumbers: readonly number[] | null,
	): OfflineProjectionGraph => {
		const graphParentByNumber = mainPostNumbers
			? new Map<number, number | null>(mainPostNumbers.map(
				(postNumber) => [postNumber, null],
			))
			: new Map<number, number | null>(canonicalParentByNumber);
		const graphChildrenByNumber = new Map<number, number[]>();
		for (const [postNumber, parentPostNumber] of graphParentByNumber) {
			if (parentPostNumber === null) continue;
			const children = graphChildrenByNumber.get(parentPostNumber) ?? [];
			children.push(postNumber);
			graphChildrenByNumber.set(parentPostNumber, children);
		}
		for (const children of graphChildrenByNumber.values()) {
			children.sort((left, right) => left - right);
		}
		const rootNumbers = [...graphParentByNumber.keys()]
			.filter((postNumber) => graphParentByNumber.get(postNumber) === null)
			.sort((left, right) => left - right);
		const graphEntries: OfflineEntry[] = [];
		const graphIndexByPost = new Map<number, number>();
		const stack: Array<Readonly<{
			postNumber: number;
			parentPostNumber: number | null;
			depth: number;
			closing: boolean;
		}>> = [];
		for (let index = rootNumbers.length - 1; index >= 0; index -= 1) {
			stack.push({
				postNumber: rootNumbers[index]!,
				parentPostNumber: null,
				depth: 0,
				closing: false,
			});
		}
		while (stack.length) {
			const current = stack.pop()!;
			if (current.closing) {
				const index = graphIndexByPost.get(current.postNumber);
				if (index !== undefined) {
					graphEntries[index]!.subtreeEndIndex = graphEntries.length;
				}
				continue;
			}
			const index = graphEntries.length;
			graphIndexByPost.set(current.postNumber, index);
			graphEntries.push({
				postNumber: current.postNumber,
				parentPostNumber: current.parentPostNumber,
				depth: current.depth,
				subtreeEndIndex: index + 1,
			});
			stack.push({ ...current, closing: true });
			const children = graphChildrenByNumber.get(current.postNumber) ?? [];
			for (
				let childIndex = children.length - 1;
				childIndex >= 0;
				childIndex -= 1
			) {
				stack.push({
					postNumber: children[childIndex]!,
					parentPostNumber: current.postNumber,
					depth: current.depth + 1,
					closing: false,
				});
			}
		}
		return {
			parentByNumber: graphParentByNumber,
			childrenByNumber: graphChildrenByNumber,
			entries: graphEntries,
			indexByPost: graphIndexByPost,
		};
	};
	let projectionGraph = createProjectionGraph(activeMainPostNumbers);
	let parentByNumber = projectionGraph.parentByNumber;
	let childrenByNumber = projectionGraph.childrenByNumber;
	let entries = projectionGraph.entries;
	let indexByPost = projectionGraph.indexByPost;
	const createCollapsedBranches = (): Set<number> => {
		const result = new Set<number>();
		if (selectedProjection) return result;
		for (const [postNumber, children] of childrenByNumber) {
			if (
				children.length > 0 &&
				(canonicalDepthByNumber.get(postNumber) ?? 0) >=
					inlineReplyTreeMaxDepth
			) result.add(postNumber);
		}
		return result;
	};
	let collapsedBranches = createCollapsedBranches();
	const subtreeEnds = (values: readonly OfflineEntry[]): Map<number, number> => {
		const result = new Map<number, number>();
		const pending: Array<Readonly<{ postNumber: number; depth: number }>> = [];
		for (const [index, entry] of values.entries()) {
			while (pending.length && pending.at(-1)!.depth >= entry.depth) {
				result.set(pending.pop()!.postNumber, index);
			}
			pending.push({ postNumber: entry.postNumber, depth: entry.depth });
		}
		while (pending.length) result.set(pending.pop()!.postNumber, values.length);
		return result;
	};
	const branchVisible = (entry: OfflineEntry): boolean => {
		let parentPostNumber = entry.parentPostNumber;
		while (parentPostNumber !== null) {
			if (collapsedBranches.has(parentPostNumber)) return false;
			parentPostNumber = parentByNumber.get(parentPostNumber) ?? null;
		}
		return true;
	};
	let visibleEntries = entries.filter(branchVisible);
	let visibleIndexByPost = new Map<number, number>(visibleEntries.map(
		(entry, index) => [entry.postNumber, index],
	));
	let visibleSubtreeEndByPost = subtreeEnds(visibleEntries);

	const estimateOwnSize = (post: OfflinePost): number => {
		const prepared = Math.round(Number(post.offline_estimated_size));
		if (Number.isFinite(prepared) && prepared > 0) return prepared;
		const cooked = String(post.cooked || '');
		const textLength = cooked.replace(/<[^>]*>/g, ' ').length;
		const imageCount = (cooked.match(/<(?:img|video|iframe)\b/gi) ?? []).length;
		const codeLines = (cooked.match(/\n/g) ?? []).length;
		return Math.max(150, Math.min(
			2_400,
			150 + Math.ceil(textLength / 88) * 23 +
				Math.min(4, imageCount) * 220 + Math.min(20, codeLines) * 12,
		));
	};
	const estimatedOwnSizes = new Map<number, number>(posts.map(
		(post: OfflinePost) => [Number(post.post_number), estimateOwnSize(post)],
	));
	const measuredOwnSizes = new Map<number, number>();
	let prefix = new Array<number>(visibleEntries.length + 1).fill(0);
	let prefixDirtyFrom = 0;
	const ownSize = (postNumber: number): number =>
		measuredOwnSizes.get(postNumber) ??
		estimatedOwnSizes.get(postNumber) ?? 280;
	const ensurePrefix = (): void => {
		for (let index = prefixDirtyFrom; index < visibleEntries.length; index += 1) {
			prefix[index + 1] = (prefix[index] ?? 0) +
				ownSize(visibleEntries[index]!.postNumber);
		}
		prefixDirtyFrom = visibleEntries.length;
	};
	const firstEndingAfter = (offset: number): number => {
		ensurePrefix();
		let low = 0;
		let high = visibleEntries.length;
		while (low < high) {
			const middle = Math.floor((low + high) / 2);
			if ((prefix[middle + 1] ?? 0) <= offset) low = middle + 1;
			else high = middle;
		}
		return low;
	};
	const firstStartingAtOrAfter = (offset: number): number => {
		ensurePrefix();
		let low = 0;
		let high = visibleEntries.length;
		while (low < high) {
			const middle = Math.floor((low + high) / 2);
			if ((prefix[middle] ?? 0) < offset) low = middle + 1;
			else high = middle;
		}
		return low;
	};
	const deriveWindowRange = (): OfflineWindowRange => {
		ensurePrefix();
		const totalSize = prefix.at(-1) ?? 0;
		const viewportSize = Math.max(
			320,
			viewport.clientHeight || window.innerHeight || 800,
		);
		const scrollOffset = Math.max(
			0,
			Math.min(
				Number(viewport.scrollTop) || 0,
				Math.max(0, totalSize - 1),
			),
		);
		const materializationStep = viewportSize * 0.5;
		const materializationStart = Math.floor(
			scrollOffset / materializationStep,
		) * materializationStep;
		const overscanStart = Math.max(
			0,
			materializationStart - viewportSize * 1.5,
		);
		const overscanEnd = Math.min(
			totalSize,
			materializationStart + materializationStep + viewportSize * 3,
		);
		const overscanStartIndex = firstEndingAfter(overscanStart);
		const overscanEndIndex = Math.min(
			visibleEntries.length,
			Math.max(
				overscanStartIndex + 1,
				firstStartingAtOrAfter(overscanEnd),
			),
		);
		const visibleStart = firstEndingAfter(scrollOffset);
		const visibleEnd = Math.min(
			visibleEntries.length,
			Math.max(
				visibleStart + 1,
				firstStartingAtOrAfter(
					Math.min(totalSize, scrollOffset + viewportSize),
				),
			),
		);
		const contentBudget = window.innerWidth <= 700 ? 36 : 64;
		const budget = Math.max(contentBudget, visibleEnd - visibleStart);
		let start = visibleStart;
		let end = visibleEnd;
		while (
			end - start < budget &&
			(start > overscanStartIndex || end < overscanEndIndex)
		) {
			const beforeDistance = start > overscanStartIndex
				? Math.max(0, scrollOffset - (prefix[start] ?? 0))
				: Number.POSITIVE_INFINITY;
			const afterDistance = end < overscanEndIndex
				? Math.max(
					0,
					(prefix[end] ?? totalSize) - (scrollOffset + viewportSize),
				)
				: Number.POSITIVE_INFINITY;
			if (beforeDistance <= afterDistance && start > overscanStartIndex) {
				start -= 1;
			} else if (end < overscanEndIndex) {
				end += 1;
			} else {
				break;
			}
		}
		return { start, end, visibleStart, visibleEnd };
	};

	let frame = 0;
	let hydrationHandle: number | null = null;
	let hydrationGeneration = 0;
	let currentContentPostNumbers = new Set<number>();
	let lastWindowKey = '';
	const views = new Map<number, OfflineView>();
	const idleWindow = window as OfflineIdleWindow;

	const absoluteUrl = (value: unknown): string => {
		try {
			return new URL(
				String(value || ''),
				String(data.baseUrl || data.sourceUrl || location.href),
			).href;
		} catch {
			return String(value || '');
		}
	};
	const inlineEmojiSources = data.inlineEmojiSources &&
		typeof data.inlineEmojiSources === 'object' &&
		!Array.isArray(data.inlineEmojiSources)
		? data.inlineEmojiSources as Readonly<Record<string, unknown>>
		: {};
	const prepareOfflineInlineEmoji = (root: ParentNode): number => {
		const walker = document.createTreeWalker(root, 4);
		const textNodes: Text[] = [];
		for (let current = walker.nextNode(); current; current = walker.nextNode()) {
			if (current.nodeType !== 3 || !current.nodeValue?.includes(':')) continue;
			const parent = current.parentElement;
			if (
				!parent || parent.closest(
					'code,pre,kbd,samp,script,style,textarea,' +
					'.ldp-offline-inline-emoji',
				)
			) continue;
			textNodes.push(current as Text);
		}
		let rendered = 0;
		for (const text of textNodes) {
			const value = text.nodeValue ?? '';
			const matches = [...value.matchAll(/:([a-z0-9_+\-]+):/giu)]
				.map((match) => Object.freeze({
					raw: match[0],
					id: String(match[1] ?? ''),
					index: match.index ?? 0,
					source: String(inlineEmojiSources[String(match[1] ?? '')] ?? '')
						.trim(),
				}))
				.filter((match) => match.source);
			if (!matches.length) continue;
			const fragment = document.createDocumentFragment();
			let cursor = 0;
			for (const match of matches) {
				if (match.index > cursor) {
					fragment.append(document.createTextNode(value.slice(cursor, match.index)));
				}
				const image = document.createElement('img');
				image.className = 'emoji ldp-offline-inline-emoji';
				image.src = absoluteUrl(match.source);
				image.alt = match.raw;
				image.loading = 'lazy';
				image.decoding = 'async';
				image.addEventListener('error', () => {
					image.replaceWith(document.createTextNode(match.raw));
				}, { once: true });
				fragment.append(image);
				cursor = match.index + match.raw.length;
				rendered += 1;
			}
			if (cursor < value.length) {
				fragment.append(document.createTextNode(value.slice(cursor)));
			}
			text.replaceWith(fragment);
		}
		return rendered;
	};
	const offlineIcon = (
		name: 'arrow-up' | 'chevron-down' | 'chevron-left' | 'chevron-up' |
			'layers' | 'minus' | 'plus' | 'tag',
	): SVGSVGElement => {
		const namespace = 'http://www.w3.org/2000/svg';
		const icon = document.createElementNS(namespace, 'svg');
		icon.classList.add('ldp-icon');
		icon.dataset.icon = name;
		icon.setAttribute('viewBox', '0 0 24 24');
		icon.setAttribute('aria-hidden', 'true');
		icon.setAttribute('fill', 'none');
		icon.setAttribute('stroke', 'currentColor');
		icon.setAttribute('stroke-width', '2');
		icon.setAttribute('stroke-linecap', 'round');
		icon.setAttribute('stroke-linejoin', 'round');
		const paths: Readonly<Record<typeof name, readonly string[]>> = {
			'arrow-up': Object.freeze(['M12 19V5', 'm5 12 7-7 7 7']),
			'chevron-down': Object.freeze(['m6 9 6 6 6-6']),
			'chevron-left': Object.freeze(['m15 18-6-6 6-6']),
			'chevron-up': Object.freeze(['m18 15-6-6-6 6']),
			layers: Object.freeze([
				'm12 2 9 5-9 5-9-5 9-5Z',
				'm3 12 9 5 9-5',
				'm3 17 9 5 9-5',
			]),
			minus: Object.freeze(['M5 12h14']),
			plus: Object.freeze(['M12 5v14', 'M5 12h14']),
			tag: Object.freeze([
				'M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z',
			]),
		};
		for (const definition of paths[name]) {
			const path = document.createElementNS(namespace, 'path');
			path.setAttribute('d', definition);
			icon.append(path);
		}
		if (name === 'tag') {
			const hole = document.createElementNS(namespace, 'circle');
			hole.setAttribute('cx', '7.5');
			hole.setAttribute('cy', '7.5');
			hole.setAttribute('r', '.5');
			hole.setAttribute('fill', 'currentColor');
			hole.setAttribute('stroke', 'none');
			icon.append(hole);
		}
		return icon;
	};
	const offlineIconButton = (
		className: string,
		label: string,
		iconName: Parameters<typeof offlineIcon>[0],
	): HTMLButtonElement => {
		const result = document.createElement('button');
		result.type = 'button';
		result.className = className;
		result.setAttribute('aria-label', label);
		result.append(offlineIcon(iconName));
		return result;
	};
	const archiveStatusLabel = (statusValue: unknown): string => {
		const archiveStatus = Number(statusValue);
		if (archiveStatus === 403) return '隐藏前正文';
		return `${archiveStatus} 前正文`;
	};
	const syncOnlyOpToggle = (): void => {
		if (!onlyOpToggle) return;
		const available = Boolean(ownerUsernameKey && onlyOpPostNumbers.length);
		onlyOpToggle.disabled = !available;
		onlyOpToggle.classList.toggle('active', onlyOpActive);
		onlyOpToggle.setAttribute('aria-pressed', String(onlyOpActive));
		onlyOpToggle.setAttribute(
			'aria-label',
			available
				? `${onlyOpActive ? '退出' : '启用'}只看楼主`
				: '离线正文无法识别楼主',
		);
		onlyOpToggle.title = available
			? `${onlyOpActive ? '显示原始离线范围' : '只显示楼主发布的楼层'}（${
				onlyOpPostNumbers.length
			} 楼）`
			: '离线正文无法识别楼主';
	};
	const updateStatus = (): void => {
		const mainCount = selectedProjection
			? activeMainPostNumbers?.length ?? 0
			: posts.length;
		const expected = activeProjectionMode === 'op'
			? Math.max(posts.length, Number(data.expectedPostCount) || 0)
			: Number(data.expectedPostCount) || mainCount;
		const mode = data.complete ? '完整离线正文' : '可用本地正文';
		const generatedAt = new Date(Number(data.generatedAt));
		const generated = Number.isFinite(generatedAt.getTime())
			? ` · ${generatedAt.toLocaleString()} 下载`
			: '';
		const coverage = selectedProjection
			? `${activeProjectionMode === 'op' ? '只看楼主' : '自定义楼层'} ` +
				`${mainCount}/${expected} · 已准备 ${posts.length} 楼讨论上下文`
			: `${posts.length}/${expected} 楼`;
		status.textContent = `${mode} · ${coverage}${generated}`;
		syncOnlyOpToggle();
	};
	const scheduleRender = (force = false): void => {
		if (force && frame) {
			cancelAnimationFrame(frame);
			frame = 0;
		}
		if (frame) return;
		frame = requestAnimationFrame(() => render(force));
	};
	const rebuildVisibleWindow = (): void => {
		visibleEntries = entries.filter(branchVisible);
		visibleIndexByPost = new Map(visibleEntries.map(
			(entry, index) => [entry.postNumber, index],
		));
		visibleSubtreeEndByPost = subtreeEnds(visibleEntries);
		prefix = new Array<number>(visibleEntries.length + 1).fill(0);
		prefixDirtyFrom = 0;
		lastWindowKey = '';
		scheduleRender(true);
	};
	const prepareImageZoom = (root: HTMLElement): void => {
		const scales = [50, 100, 150, 200] as const;
		const minimumScale = 50;
		const maximumScale = 200;
		for (const image of root.querySelectorAll<HTMLImageElement>('img')) {
			if (
				image.closest('.ldp-offline-image-frame') ||
				image.closest('aside.onebox') ||
				image.matches(
					'.emoji,.emoji-custom,.avatar,.ldp-avatar,' +
					'.ldp-boost-avatar,.ldp-pv-comment-avatar,.ldp-solved-avatar',
				) ||
				image.closest('.onebox-avatar,.user-card-avatar')
			) continue;
			const picture = image.closest<HTMLPictureElement>('picture');
			const linkedMedia = (picture ?? image).closest<HTMLAnchorElement>('a[href]');
			const media = linkedMedia &&
				linkedMedia.querySelectorAll('img').length === 1 &&
				!(linkedMedia.textContent ?? '').trim()
				? linkedMedia
				: picture ?? image;
			if (!media.parentNode) continue;
			const frame = document.createElement('span');
			frame.className = 'ldp-offline-image-frame';
			frame.tabIndex = 0;
			frame.setAttribute('role', 'button');
			frame.dataset.offlineImageScale = '50';
			const applyScale = (scaleValue: number): void => {
				const scale = Math.min(
					maximumScale,
					Math.max(minimumScale, Math.round(Number(scaleValue) || 50)),
				);
				frame.dataset.offlineImageScale = String(scale);
				frame.style.setProperty('--ldp-offline-image-scale', `${scale}%`);
				frame.setAttribute(
					'aria-label',
					`正文图片，当前 ${scale}%；点击按 50%、100%、150%、200% 轮转，` +
						'按住 Ctrl 滚轮每格缩放 5%',
				);
				frame.title = `当前 ${scale}% · 点击切换 50% / 100% / 150% / 200% · ` +
					'Ctrl + 滚轮 ±5%';
				scheduleRender(true);
			};
			const cyclePresetScale = (): void => {
				const current = Number(frame.dataset.offlineImageScale) || 50;
				applyScale(scales.find((scale) => scale > current) ?? scales[0]);
			};
			media.replaceWith(frame);
			frame.append(media);
			frame.addEventListener('click', (event) => {
				const target = event.target as Element | null;
				if (!target?.closest('img')) return;
				event.preventDefault();
				event.stopPropagation();
				cyclePresetScale();
			});
			frame.addEventListener('keydown', (event) => {
				if (!['Enter', ' '].includes(event.key)) return;
				event.preventDefault();
				event.stopPropagation();
				cyclePresetScale();
			});
			frame.addEventListener('wheel', (event) => {
				if (!event.ctrlKey) return;
				event.preventDefault();
				event.stopPropagation();
				const current = Number(frame.dataset.offlineImageScale) || 50;
				applyScale(current + (event.deltaY < 0 ? 5 : -5));
			}, { passive: false });
			applyScale(50);
		}
	};
	const normalizeAssets = (root: HTMLElement): void => {
		for (const image of root.querySelectorAll<HTMLImageElement>('img')) {
			const link = image.closest('a[href]');
			const linkedSource = link &&
				/(?:\/uploads\/|\.(?:avif|gif|jpe?g|png|svg|webp))(?:[?#]|$)/i
					.test(link.getAttribute('href') || '')
					? link.getAttribute('href')
					: '';
			const source = image.dataset.origSrc || image.dataset.originalSrc ||
				image.dataset.downloadSrc || linkedSource || image.dataset.src ||
				image.getAttribute('src') || '';
			if (source) {
				image.removeAttribute('srcset');
				image.removeAttribute('sizes');
				for (const candidate of image.closest('picture')
					?.querySelectorAll<HTMLSourceElement>('source') ?? []) {
					candidate.removeAttribute('srcset');
					candidate.removeAttribute('sizes');
				}
				image.src = absoluteUrl(source);
			}
			image.loading = 'lazy';
			image.decoding = 'async';
			image.addEventListener('load', () => scheduleRender(true), { once: true });
			image.addEventListener('error', () => {
				image.dataset.offlineImageError = '';
				scheduleRender(true);
			}, { once: true });
		}
		for (const frameNode of root.querySelectorAll<HTMLIFrameElement>('iframe')) {
			const source = frameNode.dataset.src || frameNode.getAttribute('src');
			if (source) frameNode.src = absoluteUrl(source);
			frameNode.loading = 'lazy';
			frameNode.addEventListener('load', () => scheduleRender(true), { once: true });
		}
		for (const media of root.querySelectorAll<HTMLElement>('video,audio,source')) {
			const source = media.dataset.src || media.getAttribute('src');
			if (source) media.setAttribute('src', absoluteUrl(source));
		}
		for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
			anchor.href = absoluteUrl(anchor.getAttribute('href'));
			anchor.target = '_blank';
			anchor.rel = 'noopener noreferrer';
		}
		prepareImageZoom(root);
	};
	const expandedQuoteKeys = new Set<string>();
	const quoteExcerptHtmlByElement = new WeakMap<HTMLElement, string>();
	const prepareOfflineHashtags = (root: HTMLElement): void => {
		for (const hashtag of root.querySelectorAll<HTMLElement>('.hashtag-cooked')) {
			const host = hashtag.matches('a')
				? hashtag
				: hashtag.querySelector<HTMLElement>('a') ?? hashtag;
			if (host.querySelector('img.emoji')) continue;
			const existing = host.querySelector<SVGElement>('svg');
			if (existing?.querySelector(
				'path,circle,rect,ellipse,line,polyline,polygon',
			)) continue;
			const icon = offlineIcon('tag');
			icon.classList.add('ldp-hashtag-icon');
			const placeholder = host.querySelector('.hashtag-icon-placeholder');
			if (placeholder) placeholder.replaceWith(icon);
			else if (existing) existing.replaceWith(icon);
			else host.prepend(icon);
		}
	};
	const prepareOfflineUserMentions = (root: HTMLElement): void => {
		const base = new URL(String(data.baseUrl || data.sourceUrl || location.href));
		for (const link of root.querySelectorAll<HTMLAnchorElement>('a.mention')) {
			let username = String(link.dataset.username ?? '')
				.trim()
				.replace(/^@+/, '');
			if (!username) {
				try {
					const url = new URL(link.getAttribute('href') ?? '', base);
					const match = url.origin === base.origin
						? url.pathname.match(/^\/u\/([^/]+)\/?$/i)
						: null;
					username = match?.[1] ? decodeURIComponent(match[1]) : '';
				} catch {
					username = '';
				}
			}
			if (!username) username = String(link.textContent ?? '')
				.trim()
				.replace(/^@+/, '');
			if (!username) continue;
			link.classList.add('ldp-user-link');
			link.dataset.userCard = username;
		}
	};
	const prepareOfflineInlineOneboxes = (root: HTMLElement): void => {
		for (const link of root.querySelectorAll<HTMLAnchorElement>(
			'a.inline-onebox',
		)) {
			if (link.querySelector(':scope > .ldp-inline-onebox-label')) continue;
			const labelNodes = [...link.childNodes].filter((child) => {
				const element = child.nodeType === 1 ? child as Element : null;
				return !element?.matches('svg,.svg-icon,.ldp-link-click-count');
			});
			if (!labelNodes.some((child) => (child.textContent ?? '').trim())) continue;
			const label = document.createElement('span');
			label.className = 'ldp-inline-onebox-label';
			label.append(...labelNodes);
			const icon = [...link.children].find((child) =>
				child.matches('svg,.svg-icon'));
			if (icon) icon.after(label);
			else link.prepend(label);
		}
	};
	const prepareOfflineOneboxes = (root: HTMLElement): void => {
		const selector = 'aside.onebox:is(.githubfolder,.githubrepo,' +
			'[data-onebox-src*="github.com"])';
		for (const onebox of root.querySelectorAll<HTMLElement>(selector)) {
			if (onebox.dataset.ldpGithubOneboxNormalized === '1') continue;
			const header = onebox.querySelector<HTMLElement>(':scope > header.source');
			const body = onebox.querySelector<HTMLElement>(':scope > article.onebox-body');
			const title = body?.querySelector<HTMLElement>('h3');
			if (!header || !body || !title) continue;
			const description = [...body.querySelectorAll<HTMLElement>('p')]
				.find((paragraph) =>
					!paragraph.matches('.onebox-metadata') &&
					!paragraph.closest('.onebox-metadata'));
			const thumbnail = body.querySelector<HTMLImageElement>('img.thumbnail');
			if (thumbnail) {
				for (const oldIcon of header.querySelectorAll(
					':scope > :is(img,.site-icon)',
				)) oldIcon.remove();
				thumbnail.className = 'site-icon ldp-github-onebox-logo';
				thumbnail.removeAttribute('width');
				thumbnail.removeAttribute('height');
				thumbnail.alt = '';
				header.prepend(thumbnail);
			}
			body.replaceChildren(title, ...(description ? [description] : []));
			onebox.dataset.ldpGithubOneboxNormalized = '1';
		}
	};
	const decorateOfflineClickCounts = (
		root: HTMLElement,
		post: OfflinePost,
	): void => {
		if (!Array.isArray(post.link_counts)) return;
		const counts = new Map<string, number>();
		for (const value of post.link_counts) {
			if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
			const item = value as Readonly<Record<string, unknown>>;
			const clicks = Math.max(0, Math.trunc(Number(item.clicks) || 0));
			const url = item.reflection ? '' : absoluteUrl(item.url);
			if (!url || clicks === 0) continue;
			counts.set(url, Math.max(clicks, counts.get(url) ?? 0));
		}
		for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
			if (link.querySelector(':scope > .ldp-link-click-count')) continue;
			const onebox = link.closest('aside.onebox');
			if (onebox && link.closest('header.source')) {
				const titleLink = onebox.querySelector<HTMLAnchorElement>(
					'.onebox-body h3 a[href]',
				);
				if (
					titleLink && absoluteUrl(titleLink.getAttribute('href')) ===
						absoluteUrl(link.getAttribute('href'))
				) continue;
			}
			const clicks = counts.get(absoluteUrl(link.getAttribute('href')));
			if (!clicks || !(link.textContent ?? '').trim()) continue;
			const count = document.createElement('span');
			const label = `${clicks.toLocaleString('zh-CN')} 次点击`;
			count.className = 'ldp-link-click-count';
			count.setAttribute('role', 'note');
			count.setAttribute('aria-label', label);
			count.dataset.ldpTooltipLabel = label;
			count.textContent = clicks.toLocaleString('zh-CN');
			link.append(count);
		}
	};
	const quoteKey = (
		sourcePostNumber: number,
		targetTopicId: number,
		targetPostNumber: number,
	): string => `${sourcePostNumber}:${targetTopicId}:${targetPostNumber}`;
	const prepareOfflineQuoteImages = (root: HTMLElement): void => {
		for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
			if (link.querySelector('img')) continue;
			const href = link.getAttribute('href') || '';
			if (
				!/^\s*\[image\]\s*$/i.test(link.textContent || '') ||
				!/(?:\/uploads\/|\.(?:avif|gif|jpe?g|png|svg|webp))(?:[?#]|$)/i
					.test(href)
			) continue;
			const image = document.createElement('img');
			image.src = absoluteUrl(href);
			image.alt = link.getAttribute('title') || '引用图片';
			image.loading = 'lazy';
			image.decoding = 'async';
			link.classList.add('ldp-offline-quote-image-link');
			link.replaceChildren(image);
		}
	};
	const prepareOfflineQuotes = (
		sourcePostNumber: number,
		root: HTMLElement,
	): void => {
		for (const quote of root.querySelectorAll<HTMLElement>('aside.quote')) {
			const title = quote.querySelector<HTMLElement>(':scope > .title');
			const body = quote.querySelector<HTMLElement>(':scope > blockquote');
			if (!title || !body) continue;
			if (!quoteExcerptHtmlByElement.has(quote)) {
				quoteExcerptHtmlByElement.set(quote, body.innerHTML);
			}
			quote.classList.add('ldp-post-quote');
			title.classList.add('ldp-quote-title');
			const targetPostNumber = Number(quote.dataset.post ?? 0);
			const targetTopicId = Number(quote.dataset.topic ?? data.topicId);
			if (
				!Number.isSafeInteger(targetPostNumber) || targetPostNumber < 1 ||
				!Number.isSafeInteger(targetTopicId) || targetTopicId < 1
			) continue;
			const key = quoteKey(sourcePostNumber, targetTopicId, targetPostNumber);
			const targetPost = quotedPost(targetTopicId, targetPostNumber);
			const expanded = Boolean(targetPost && expandedQuoteKeys.has(key));
			quote.classList.toggle('ldp-quote-expanded', expanded);
			quote.dataset.ldpQuoteExpanded = expanded ? '1' : '0';
			if (expanded && targetPost) {
				body.innerHTML = String(targetPost.cooked || '');
				quote.dataset.ldpQuoteHydrated = '1';
				prepareOfflineInlineOneboxes(body);
				prepareOfflineOneboxes(body);
			} else {
				const excerpt = quoteExcerptHtmlByElement.get(quote);
				if (excerpt !== undefined && body.innerHTML !== excerpt) {
					body.innerHTML = excerpt;
				}
				delete quote.dataset.ldpQuoteHydrated;
				prepareOfflineQuoteImages(body);
			}
			let controls = title.querySelector<HTMLElement>(':scope > .quote-controls');
			if (!controls) {
				controls = document.createElement('span');
				controls.className = 'quote-controls';
				title.append(controls);
			}
			controls.classList.add('ldp-quote-controls');
			controls.replaceChildren();
			if (targetPost) {
				const toggle = offlineIconButton(
					'ldp-quote-toggle',
					expanded ? '收起引用' : '展开完整引用',
					expanded ? 'chevron-up' : 'chevron-down',
				);
				toggle.dataset.offlineQuoteToggle = key;
				toggle.dataset.targetPostNumber = String(targetPostNumber);
				toggle.dataset.targetTopicId = String(targetTopicId);
				toggle.setAttribute('aria-expanded', String(expanded));
				controls.append(toggle);
			}
			const titleTarget = title.querySelector<HTMLAnchorElement>('a[href]')
				?.getAttribute('href') || '';
			const targetHref = titleTarget || (
				targetTopicId === Number(data.topicId)
					? `${String(data.sourceUrl || '').replace(/\/+$/, '')}/${
						targetPostNumber
					}`
					: ''
			);
			if (targetHref) {
				const jump = document.createElement('a');
				jump.className = 'ldp-quote-jump';
				jump.href = absoluteUrl(targetHref);
				jump.target = '_blank';
				jump.rel = 'noopener noreferrer';
				jump.setAttribute('aria-label', `跳到被引用楼层 #${targetPostNumber}`);
				jump.dataset.offlineQuoteJump = String(targetPostNumber);
				jump.dataset.targetTopicId = String(targetTopicId);
				jump.append(offlineIcon('arrow-up'));
				controls.append(jump);
			}
		}
	};
	const prepareOfflineCooked = (
		post: OfflinePost,
		root: HTMLElement,
		withClickCounts = true,
	): void => {
		prepareOfflineHashtags(root);
		prepareOfflineUserMentions(root);
		prepareOfflineInlineOneboxes(root);
		prepareOfflineOneboxes(root);
		prepareOfflineQuotes(Number(post.post_number), root);
		prepareOfflineInlineEmoji(root);
		if (withClickCounts) decorateOfflineClickCounts(root, post);
	};
	const avatarFallback = (post: OfflinePost): HTMLElement => {
		const fallback = document.createElement('span');
		fallback.className = 'ldp-avatar ldp-persistent-avatar-fallback';
		fallback.textContent = String(post.name || post.username || '?').charAt(0);
		fallback.setAttribute('aria-hidden', 'true');
		return fallback;
	};
	const textNode = (className: string, value: unknown): HTMLElement => {
		const node = document.createElement('span');
		node.className = className;
		node.textContent = String(value);
		return node;
	};
	const userLink = (
		className: string,
		value: unknown,
		usernameValue: unknown,
	): HTMLElement => {
		const username = String(usernameValue || '').trim();
		if (!username) return textNode(className, value);
		const link = document.createElement('a');
		link.className = `ldp-user-link ${className}`;
		link.href = absoluteUrl(`/u/${encodeURIComponent(username)}`);
		link.target = '_blank';
		link.rel = 'noopener noreferrer';
		link.textContent = String(value);
		return link;
	};
	const avatar = (post: OfflinePost): HTMLElement => {
		const username = String(post.username || '').trim();
		const host = document.createElement(username ? 'a' : 'span');
		host.className = 'ldp-avatar-link';
		host.dataset.readerAvatar = '';
		if (host.tagName === 'A' && username) {
			host.setAttribute('href', absoluteUrl(`/u/${encodeURIComponent(username)}`));
			host.setAttribute('target', '_blank');
			host.setAttribute('rel', 'noopener noreferrer');
		}
		host.setAttribute(
			'aria-label',
			String(post.name || post.username || '未知用户'),
		);
		const template = String(post.avatar_template || '');
		if (!template) {
			host.append(avatarFallback(post));
			return host;
		}
		const image = document.createElement('img');
		image.className = 'ldp-avatar';
		image.alt = '';
		image.loading = 'lazy';
		image.decoding = 'async';
		image.src = absoluteUrl(template.replace('{size}', '48'));
		image.addEventListener('error', () => {
			host.replaceChildren(avatarFallback(post));
			scheduleRender(true);
		}, { once: true });
		host.append(image);
		return host;
	};
	const relativeTime = (
		value: unknown,
	): { readonly relative: string; readonly exact: string } | null => {
		const timestamp = Date.parse(String(value || ''));
		if (!Number.isFinite(timestamp)) return null;
		const deltaSeconds = Math.round((timestamp - Date.now()) / 1_000);
		const units: readonly [Intl.RelativeTimeFormatUnit, number][] = [
			['year', 31_536_000],
			['month', 2_592_000],
			['day', 86_400],
			['hour', 3_600],
			['minute', 60],
			['second', 1],
		];
		const [unit, seconds] = units.find(([, size]) =>
			Math.abs(deltaSeconds) >= size) ?? units.at(-1)!;
		return {
			relative: new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })
				.format(Math.round(deltaSeconds / seconds), unit),
			exact: new Date(timestamp).toLocaleString(),
		};
	};
	const objectRecord = (value: unknown): OfflinePost | null =>
		value !== null && typeof value === 'object' && !Array.isArray(value)
			? value as OfflinePost
			: null;
	const reactionEmojiSources = objectRecord(data.reactionEmojiSources);
	const escapeText = (value: unknown): string => String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
	const prepareReadOnlyPolls = (
		post: OfflinePost,
		content: HTMLElement,
	): void => {
		const polls = Array.isArray(post.polls)
			? post.polls.map(objectRecord).filter(
				(value): value is OfflinePost => value !== null,
			)
			: [];
		if (!polls.length) return;
		const containers = [...content.querySelectorAll<HTMLElement>('.poll')];
		const used = new Set<HTMLElement>();
		for (const [pollIndex, poll] of polls.entries()) {
			const name = String(poll.name || 'poll');
			let container = containers.find((candidate) =>
				!used.has(candidate) &&
				String(candidate.dataset.pollName || 'poll') === name);
			container ??= containers.find((candidate) => !used.has(candidate));
			if (!container) {
				container = document.createElement('div');
				container.className = 'poll';
				content.append(container);
			}
			used.add(container);
			container.classList.add('ldp-reader-poll');
			container.dataset.ldpPollName = name;
			container.dataset.ldpPollShowResults = '1';
			const options = Array.isArray(poll.options)
				? poll.options.map(objectRecord).filter(
					(value): value is OfflinePost => value !== null,
				)
				: [];
			const voters = Math.max(0, Number(poll.voters) || 0);
			const results = options.map((option, optionIndex) => {
				const votesValue = Number(option.votes);
				const hasVotes = Number.isFinite(votesValue) && votesValue >= 0;
				const votes = hasVotes ? votesValue : 0;
				const percent = hasVotes && voters > 0
					? Math.min(100, Math.round(votes / voters * 100))
					: 0;
				return '<div class="ldp-poll-result">' +
					`<div class="ldp-poll-result-label">${String(
						option.html || `选项 ${optionIndex + 1}`,
					)}</div>` +
					`<div class="ldp-poll-result-value">${hasVotes
						? `${votes} 票 · ${percent}%`
						: '结果不可用'}</div>` +
					'<div class="ldp-poll-result-track">' +
					`<span class="ldp-poll-result-bar" style="width:${percent}%"></span>` +
					'</div></div>';
			}).join('');
			container.innerHTML =
				`<div class="ldp-poll-title">${escapeText(
					poll.title || `投票 ${pollIndex + 1}`,
				)}</div><div class="ldp-poll-results">${results}</div>` +
				'<div class="ldp-poll-footer"><span class="ldp-poll-meta">' +
				`${voters} 位投票人 · 离线只读</span></div>`;
		}
	};
	const prepareReadOnlySpecialContent = (
		post: OfflinePost,
		view: OfflineView,
	): void => {
		const badges: Array<readonly [string, string]> = [];
		if (Number(post.post_type) === 4) badges.push(['私信回复', '']);
		if ([2, 3].includes(Number(post.post_type))) badges.push(['系统信息', 'warn']);
		if (post.wiki === true) badges.push(['Wiki', '']);
		if (post.deleted_at) badges.push(['已删除', 'danger']);
		if (post.locked === true) badges.push(['已锁定', 'warn']);
		if (post.accepted_answer === true) badges.push(['已解决', '']);
		const event = objectRecord(post.event);
		if (!badges.length && !event) return;
		const badgeHtml = badges.length
			? '<div class="ldp-special-badges">' + badges.map(([label, tone]) =>
				`<span class="ldp-special-badge ${tone}">${label}</span>`).join('') +
				'</div>'
			: '';
		let eventHtml = '';
		if (event) {
			const dateOptions: Intl.DateTimeFormatOptions = {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
				...(event.all_day === true
					? {}
					: { hour: '2-digit', minute: '2-digit' }),
			};
			const formatDate = (value: unknown): string => {
				const date = new Date(String(value || ''));
				return Number.isFinite(date.getTime())
					? date.toLocaleString('zh-CN', dateOptions)
					: '';
			};
			const dateLabel = [formatDate(event.starts_at), formatDate(event.ends_at)]
				.filter(Boolean)
				.join(' — ');
			const location = objectRecord(event.location);
			const locationLabel = typeof event.location === 'string'
				? event.location
				: String(location?.name || location?.address || location?.display || '');
			const stats = objectRecord(event.stats);
			const statsLabel = stats
				? [
					`参加 ${Math.max(0, Number(stats.going) || 0)}`,
					`感兴趣 ${Math.max(0, Number(stats.interested) || 0)}`,
					event.is_ongoing === true ? '进行中' : '',
					event.is_expired === true ? '已结束' : '',
				].filter(Boolean).join(' · ')
				: '';
			eventHtml = '<section class="ldp-event-card">' +
				`<h3 class="ldp-event-title">${escapeText(event.name || '活动')}</h3>` +
				'<div class="ldp-event-grid">' +
				(dateLabel
					? `<div>${escapeText(`${dateLabel} ${event.timezone || ''}`.trim())}</div>`
					: '') +
				(locationLabel
					? `<div>地点：${escapeText(locationLabel)}</div>`
					: '') +
				(event.description_html
					? `<div class="cooked">${String(event.description_html)}</div>`
					: '') +
				(statsLabel
					? `<div class="ldp-event-meta">${escapeText(statsLabel)}</div>`
					: '') +
				'</div></section>';
		}
		view.body.insertAdjacentHTML(
			'beforeend',
			`<div class="ldp-post-body-layer">${badgeHtml}${eventHtml}</div>`,
		);
	};
	const prepareReadOnlySolvedAnswers = (
		post: OfflinePost,
		view: OfflineView,
	): void => {
		if (Number(post.post_number) !== 1 || !solvedAnswerPostNumbers.length) return;
		const layer = document.createElement('div');
		layer.className = 'ldp-post-body-layer ldp-offline-solved-layer';
		const card = document.createElement('section');
		card.className = 'ldp-solved-card ldp-offline-solved-card';
		const head = document.createElement('div');
		head.className = 'ldp-solved-head';
		const label = document.createElement('span');
		label.className = 'ldp-solved-label';
		label.textContent = solvedAnswerPostNumbers.length > 1
			? `已解决 · ${solvedAnswerPostNumbers.length} 个答案`
			: '已解决';
		head.append(label);
		card.append(head);
		for (const postNumber of solvedAnswerPostNumbers) {
			const answer = postByNumber.get(postNumber);
			if (!answer) continue;
			const body = document.createElement('div');
			body.className = 'ldp-solved-body';
			body.dataset.solvedPostNumber = String(postNumber);
			const authorRow = document.createElement('div');
			authorRow.className = 'ldp-solved-author-row';
			const avatarTemplate = String(answer.avatar_template ?? '');
			if (avatarTemplate) {
				const image = document.createElement('img');
				image.className = 'ldp-solved-avatar';
				image.src = avatarTemplate.replace(/\{size\}/g, '32');
				image.alt = '';
				image.loading = 'lazy';
				image.decoding = 'async';
				authorRow.append(image);
			}
			const author = document.createElement('strong');
			author.className = 'ldp-solved-author';
			author.textContent = String(
				answer.name ?? answer.username ?? '已解决回复',
			);
			authorRow.append(author);
			if (answer.username) {
				const username = document.createElement('span');
				username.className = 'ldp-solved-username';
				username.textContent = `@${String(answer.username)}`;
				authorRow.append(username);
			}
			const created = relativeTime(answer.created_at);
			if (created) {
				const time = document.createElement('span');
				time.className = 'ldp-time';
				time.dataset.exactTime = created.exact;
				time.title = created.exact;
				time.append(textNode(
					'ldp-time-relative',
					`· ${created.relative}`,
				));
				authorRow.append(time);
			}
			const floor = document.createElement('span');
			floor.className = 'ldp-solved-floor ldp-offline-solved-floor';
			floor.textContent = `#${postNumber}`;
			authorRow.append(floor);
			const excerpt = document.createElement('div');
			excerpt.className = 'ldp-solved-excerpt ldp-content cooked';
			excerpt.innerHTML = String(answer.cooked ?? answer.excerpt ?? '');
			body.append(authorRow, excerpt);
			card.append(body);
		}
		layer.append(card);
		view.body.append(layer);
	};
	const prepareReadOnlyBoosts = (
		post: OfflinePost,
		view: OfflineView,
		ownerUsername: string,
	): void => {
		const values = Array.isArray(post.boosts)
			? post.boosts
			: post.boosts ? [post.boosts] : [];
		const boosts = values.map(objectRecord).filter(
			(value): value is OfflinePost => value !== null,
		).filter((value) => String(value.cooked ?? value.raw ?? '').trim());
		if (!boosts.length) return;
		const list = document.createElement('div');
		list.className = 'ldp-boost-list ldp-offline-boost-list';
		for (const boost of boosts) {
			const user = objectRecord(boost.user) ?? {};
			const username = String(user.username ?? boost.username ?? '').trim();
			const bubble = document.createElement('span');
			bubble.className = 'ldp-boost-bubble ldp-offline-boost-bubble';
			bubble.setAttribute(
				'aria-label',
				username ? `@${username} 的 Boost` : 'Boost',
			);
			bubble.title = username ? `@${username} 的 Boost` : 'Boost';
			const avatarTemplate = String(
				user.avatar_template ?? boost.avatar_template ??
					boost.avatarTemplate ?? boost.avatar ?? '',
			).trim();
			const avatarHost = document.createElement(username ? 'a' : 'span');
			avatarHost.className = username
				? 'ldp-user-link ldp-boost-avatar-link'
				: 'ldp-boost-avatar-link';
			if (avatarHost.tagName === 'A' && username) {
				avatarHost.setAttribute(
					'href',
					absoluteUrl(`/u/${encodeURIComponent(username)}`),
				);
				avatarHost.setAttribute('target', '_blank');
				avatarHost.setAttribute('rel', 'noopener noreferrer');
				avatarHost.setAttribute('aria-label', `查看 @${username} 的用户信息`);
				avatarHost.title = `查看 @${username} 的用户信息`;
			}
			if (avatarTemplate) {
				const image = document.createElement('img');
				image.className = 'ldp-boost-avatar';
				image.alt = '';
				image.loading = 'lazy';
				image.decoding = 'async';
				image.addEventListener('error', () => {
					const fallback = document.createElement('span');
					fallback.className = 'ldp-boost-fallback-icon';
					fallback.textContent = '🚀';
					avatarHost.replaceChildren(fallback);
					scheduleRender(true);
				}, { once: true });
				image.src = absoluteUrl(avatarTemplate.replace(/\{size\}/g, '24'));
				avatarHost.append(image);
			} else {
				const fallback = document.createElement('span');
				fallback.className = 'ldp-boost-fallback-icon';
				fallback.textContent = '🚀';
				avatarHost.append(fallback);
			}
			bubble.append(avatarHost);
			const identities = document.createElement('span');
			identities.className = 'ldp-boost-identities';
			const addIdentity = (label: string, className = ''): void => {
				const identity = document.createElement('span');
				identity.className = `ldp-boost-identity ${className}`.trim();
				identity.textContent = label;
				identities.append(identity);
			};
			if (
				username && ownerUsername &&
				username.toLocaleLowerCase() === ownerUsername.toLocaleLowerCase()
			) addIdentity('OP', 'ldp-boost-identity-op');
			if (user.admin === true || boost.admin === true) {
				addIdentity('管理员', 'ldp-boost-identity-admin');
			} else if (
				user.moderator === true || user.group_moderator === true ||
				boost.moderator === true || boost.group_moderator === true
			) addIdentity('版主', 'ldp-boost-identity-moderator');
			const notice = objectRecord(boost.notice);
			const noticeType = String(notice?.type ?? boost.notice_type ?? '');
			if (noticeType === 'new_user') addIdentity('新用户');
			else if (noticeType === 'returning_user') addIdentity('回归');
			else if (noticeType === 'custom') addIdentity('提示');
			if (identities.childElementCount) bubble.append(identities);
			const cooked = document.createElement('span');
			cooked.className = 'ldp-boost-cooked cooked';
			if (boost.cooked) cooked.innerHTML = String(boost.cooked);
			else cooked.textContent = String(boost.raw ?? '');
			bubble.append(cooked);
			list.append(bubble);
		}
		view.body.append(list);
		view.root.classList.add('ldp-has-boosts');
	};
	const prepareReadOnlyReactions = (
		post: OfflinePost,
		view: OfflineView,
	): void => {
		const reactions = (Array.isArray(post.reactions) ? post.reactions : [])
			.map(objectRecord)
			.filter((value): value is OfflinePost => value !== null)
			.map((value) => ({
				id: String(value.id ?? '').trim().replace(/^:+|:+$/g, ''),
				count: Math.max(0, Number(value.count) || 0),
			}))
			.filter((value) => value.id && value.count > 0);
		if (!reactions.length) {
			const like = (Array.isArray(post.actions_summary)
				? post.actions_summary
				: []).map(objectRecord).find((value) =>
					Number(value?.id) === 2 || Number(value?.action_type_id) === 2);
			const count = Math.max(0, Number(like?.count) || 0);
			if (count) reactions.push({ id: 'heart', count });
		}
		if (!reactions.length) return;
		const labels: Readonly<Record<string, string>> = {
			heart: '♥',
			'+1': '👍',
			thumbsup: '👍',
			laughing: '😆',
			open_mouth: '😮',
			cry: '😢',
			angry: '😠',
			clap: '👏',
			eyes: '👀',
			thinking: '🤔',
		};
		const host = document.createElement('div');
		host.className = 'ldp-reactions ldp-offline-reactions';
		const summary = document.createElement('div');
		summary.className = 'ldp-reaction-summary';
		for (const reaction of reactions) {
			const chip = document.createElement('span');
			chip.className = 'ldp-reaction-chip ldp-offline-reaction-chip';
			chip.dataset.reaction = reaction.id;
			chip.setAttribute('aria-label', `${reaction.id} ${reaction.count}`);
			const graphic = document.createElement('span');
			const imageSource = String(
				reactionEmojiSources?.[reaction.id] ?? '',
			).trim();
			if (imageSource) {
				const image = document.createElement('img');
				image.className = 'emoji only-emoji';
				image.src = absoluteUrl(imageSource);
				image.alt = reaction.id;
				image.loading = 'lazy';
				image.decoding = 'async';
				graphic.append(image);
			} else {
				graphic.textContent = labels[reaction.id] ?? `:${reaction.id}:`;
			}
			const count = document.createElement('b');
			count.textContent = String(reaction.count);
			chip.append(graphic, count);
			summary.append(chip);
		}
		host.append(summary);
		view.body.append(host);
		view.root.classList.add('ldp-has-reactions');
	};
	const prepareReadOnlyPostVoting = (
		post: OfflinePost,
		view: OfflineView,
	): void => {
		if (!postVotingEnabled || Number(post.post_number) === 1) return;
		view.root.classList.add('ldp-post-voting-answer');
		const layer = document.createElement('div');
		layer.className = 'ldp-post-body-layer ldp-offline-post-voting';
		const votes = document.createElement('div');
		votes.className = 'ldp-pv-votes ldp-offline-pv-votes';
		const voteLabel = document.createElement('span');
		voteLabel.className = 'ldp-offline-pv-label';
		voteLabel.textContent = '得票';
		const score = document.createElement('span');
		score.className = 'ldp-pv-score';
		score.textContent = String(
			Math.max(0, Number(post.post_voting_vote_count) || 0),
		);
		votes.append(voteLabel, score);
		layer.append(votes);
		const comments = (Array.isArray(post.post_voting_comments)
			? post.post_voting_comments
			: Array.isArray(post.comments) ? post.comments : [])
			.map(objectRecord)
			.filter((value): value is OfflinePost => value !== null);
		const expectedComments = Math.max(
			comments.length,
			Math.max(0, Number(post.comments_count) || 0),
		);
		if (expectedComments) {
			const host = document.createElement('section');
			host.className = 'ldp-pv-comments ldp-offline-pv-comments';
			const heading = document.createElement('strong');
			heading.className = 'ldp-offline-pv-comments-title';
			heading.textContent = comments.length < expectedComments
				? `评论（本地 ${comments.length}/${expectedComments}）`
				: `评论（${comments.length}）`;
			host.append(heading);
			for (const comment of comments) {
				const row = document.createElement('article');
				row.className = 'ldp-pv-comment';
				const avatarTemplate = String(
					comment.avatar_template ?? comment.avatarTemplate ?? '',
				);
				if (avatarTemplate) {
					const image = document.createElement('img');
					image.className = 'ldp-pv-comment-avatar';
					image.src = avatarTemplate.replace(/\{size\}/g, '26');
					image.alt = '';
					image.loading = 'lazy';
					row.append(image);
				} else {
					const fallback = document.createElement('span');
					fallback.className = 'ldp-avatar-fallback ldp-pv-comment-avatar';
					fallback.textContent = String(comment.username ?? '?').slice(0, 1);
					row.append(fallback);
				}
				const body = document.createElement('div');
				body.className = 'ldp-pv-comment-body';
				const meta = document.createElement('div');
				meta.className = 'ldp-pv-comment-meta';
				meta.textContent = String(
					comment.name ?? comment.username ?? '未知用户',
				);
				const content = document.createElement('div');
				content.className = 'ldp-content cooked';
				if (comment.cooked) content.innerHTML = String(comment.cooked);
				else content.textContent = String(comment.raw ?? '');
				body.append(meta, content);
				const commentScore = document.createElement('span');
				commentScore.className = 'ldp-pv-score';
				commentScore.textContent = String(
					Math.max(0, Number(comment.post_voting_vote_count) || 0),
				);
				commentScore.setAttribute('aria-label', '评论得票');
				row.append(body, commentScore);
				host.append(row);
			}
			layer.append(host);
		}
		view.body.append(layer);
	};
	/** 一条连续可见树只保留一个“完整讨论”入口，与在线阅读器 owner 规则一致。 */
	const discussionBranchOwner = (postNumber: number): number | null => {
		if (selectedProjection) return postNumber;
		let rootPostNumber = postNumber;
		let parentPostNumber = parentByNumber.get(rootPostNumber) ?? null;
		while (parentPostNumber !== null) {
			rootPostNumber = parentPostNumber;
			parentPostNumber = parentByNumber.get(rootPostNumber) ?? null;
		}
		if (rootPostNumber !== 1) return rootPostNumber;
		if (postNumber === 1) return null;
		let owner = postNumber;
		let parent = parentByNumber.get(owner) ?? null;
		while (parent !== null && parent !== 1) {
			owner = parent;
			parent = parentByNumber.get(owner) ?? null;
		}
		return owner;
	};
	const branchHasParkedDiscussion = (rootPostNumber: number): boolean => {
		if (selectedProjection) return true;
		const pending = [rootPostNumber];
		const visited = new Set<number>();
		while (pending.length) {
			const postNumber = pending.pop()!;
			if (visited.has(postNumber)) continue;
			visited.add(postNumber);
			if (collapsedBranches.has(postNumber)) return true;
			const canonicalChildren =
				canonicalChildrenByNumber.get(postNumber) ?? [];
			const projectedChildren = childrenByNumber.get(postNumber) ?? [];
			if (canonicalChildren.some((child) => !projectedChildren.includes(child))) {
				return true;
			}
			const replyCount = Math.max(
				0,
				Math.trunc(Number(postByNumber.get(postNumber)?.reply_count) || 0),
			);
			if (replyCount > canonicalChildren.length && !projectedChildren.length) {
				return true;
			}
			pending.push(...projectedChildren);
		}
		return false;
	};
	const showsContextDiscussion = (entry: OfflineEntry): boolean =>
		discussionBranchOwner(entry.postNumber) === entry.postNumber &&
		branchHasParkedDiscussion(entry.postNumber);
	const createView = (
		entry: OfflineEntry,
		viewOptions: Readonly<{
			readonly children?: ReadonlyMap<number, readonly number[]>;
			readonly register?: boolean;
			readonly idPrefix?: string;
			readonly controlScope?: 'main' | 'discussion';
			readonly showDiscussion?: boolean;
		}> = {},
	): OfflineView => {
		const post = postByNumber.get(entry.postNumber)!;
		const root = document.createElement('article');
		root.className = 'ldp-post';
		root.tabIndex = -1;
		root.id = `${viewOptions.idPrefix ?? 'post_'}${entry.postNumber}`;
		root.dataset.postId = String(post.id || entry.postNumber);
		root.dataset.postNumber = String(entry.postNumber);
		root.dataset.username = String(post.username || '');
		if (post.created_at) root.dataset.createdAt = String(post.created_at);
		root.innerHTML = '<header class="ldp-post-head"></header>' +
			'<div class="ldp-post-body"><div class="ldp-content cooked"></div>' +
			'<div class="ldp-post-body-layer"></div></div>' +
			'<section class="ldp-children ldp-reply-tree">' +
			'<div class="ldp-reply-list"></div>' +
			'<div class="ldp-reply-controls"></div></section>';
		const header = root.querySelector<HTMLElement>('.ldp-post-head')!;
		const body = root.querySelector<HTMLElement>('.ldp-post-body')!;
		const content = root.querySelector<HTMLElement>('.ldp-content')!;
		const bodyLayer = root.querySelector<HTMLElement>('.ldp-post-body-layer')!;
		const replyTree = root.querySelector<HTMLElement>('.ldp-reply-tree')!;
		const replyList = root.querySelector<HTMLElement>('.ldp-reply-list')!;
		const replyControls = root.querySelector<HTMLElement>('.ldp-reply-controls')!;
		const viewChildren = viewOptions.children ?? childrenByNumber;
		const hasProjectedChildren =
			(viewChildren.get(entry.postNumber)?.length ?? 0) > 0;
		const hasCanonicalChildren =
			(canonicalChildrenByNumber.get(entry.postNumber)?.length ?? 0) > 0;
		const mainControlScope = (viewOptions.controlScope ?? 'main') === 'main';
		root.classList.toggle('ldp-has-child-branches', hasProjectedChildren);
		let branchToggle: HTMLButtonElement | null = null;
		let branchDiscussion: HTMLButtonElement | null = null;
		let contextDiscussion: HTMLButtonElement | null = null;
		if (hasProjectedChildren || hasCanonicalChildren) {
			if (hasProjectedChildren) {
				branchToggle = document.createElement('button');
				branchToggle.type = 'button';
				branchToggle.className =
					'ldp-reader-branch-toggle ldp-offline-branch-toggle';
				branchToggle.dataset.offlineBranchToggle = String(entry.postNumber);
				branchToggle.dataset.offlineBranchScope =
					viewOptions.controlScope ?? 'main';
				root.insertBefore(branchToggle, header);
			}
			if (hasProjectedChildren && viewOptions.showDiscussion !== false) {
				branchDiscussion = document.createElement('button');
				branchDiscussion.type = 'button';
				branchDiscussion.className = 'ldp-offline-branch-discussion';
				branchDiscussion.dataset.offlineBranchDiscussion = String(
					entry.postNumber,
				);
				branchDiscussion.dataset.offlineDiscussionKind = 'branch';
				branchDiscussion.append(
					offlineIcon('layers'),
					textNode('ldp-offline-branch-discussion-label', '查看完整分支'),
				);
				branchDiscussion.setAttribute(
					'aria-label',
					`查看楼层 #${entry.postNumber} 以下的完整分支`,
				);
				root.insertBefore(branchDiscussion, header);
			}
		}
		if (
			mainControlScope &&
			viewOptions.showDiscussion !== false &&
			discussionBranchOwner(entry.postNumber) === entry.postNumber
		) {
			contextDiscussion = document.createElement('button');
			contextDiscussion.type = 'button';
			contextDiscussion.className =
				'ldp-offline-branch-discussion ldp-offline-context-discussion';
			contextDiscussion.dataset.offlineBranchDiscussion =
				String(entry.postNumber);
			contextDiscussion.dataset.offlineDiscussionKind = 'context';
			contextDiscussion.append(
				offlineIcon('layers'),
				textNode('ldp-offline-branch-discussion-label', '查看完整讨论'),
			);
			contextDiscussion.setAttribute(
				'aria-label',
				`查看楼层 #${entry.postNumber} 所属的完整讨论`,
			);
			replyControls.append(contextDiscussion);
		}
		const view: OfflineView = {
			postNumber: entry.postNumber,
			root,
			header,
			body,
			content,
			bodyLayer,
			replyTree,
			replyList,
			replyControls,
			branchToggle,
			branchDiscussion,
			contextDiscussion,
			hydrated: false,
		};
		if (viewOptions.register !== false) views.set(entry.postNumber, view);
		return view;
	};
	const renderBranchSymbol = (
		toggle: HTMLButtonElement,
		collapsed: boolean,
	): void => {
		const symbol = offlineIcon(collapsed ? 'plus' : 'minus');
		symbol.classList.add('ldp-offline-branch-symbol');
		toggle.dataset.offlineBranchState = collapsed ? 'collapsed' : 'expanded';
		toggle.replaceChildren(symbol);
	};
	const positionBranchToggle = (
		view: OfflineView,
		collapsed: boolean,
	): void => {
		const toggle = view.branchToggle;
		if (!toggle) return;
		/*
		 * 每个确实拥有直属子楼的父节点都只持有一个收纳控件：展开时把“−”
		 * 锚到首个子用户头像上方，收起时把同一个控件还原为父楼旁的“+”。
		 * 不能只允许树根显示“−”，否则嵌套父分支会失去自己的收纳入口。
		 */
		const anchorToFirstChild = !collapsed;
		toggle.classList.toggle(
			'ldp-offline-branch-first-child-anchor',
			anchorToFirstChild,
		);
		toggle.hidden = false;
		if (anchorToFirstChild) {
			view.replyTree.insertBefore(toggle, view.replyList);
		} else {
			toggle.style.removeProperty('--ldp-offline-branch-anchor-offset');
			view.root.insertBefore(toggle, view.header);
		}
	};
	const syncBranchControls = (view: OfflineView, entry: OfflineEntry): void => {
		const collapsed = collapsedBranches.has(entry.postNumber);
		view.root.classList.toggle('ldp-branch-parent-collapsed', collapsed);
		view.replyList.hidden = collapsed;
		if (view.branchDiscussion) view.branchDiscussion.hidden = !collapsed;
		if (view.contextDiscussion) {
			view.contextDiscussion.hidden = !showsContextDiscussion(entry);
		}
		if (!view.branchToggle) return;
		positionBranchToggle(view, collapsed);
		if (collapsed && view.branchDiscussion) {
			view.root.insertBefore(view.branchToggle, view.branchDiscussion);
		}
		const descendantCount = Math.max(
			1,
			entry.subtreeEndIndex - (indexByPost.get(entry.postNumber) ?? 0) - 1,
		);
		renderBranchSymbol(view.branchToggle, collapsed);
		view.branchToggle.setAttribute('aria-expanded', String(!collapsed));
		view.branchToggle.setAttribute(
			'aria-label',
			collapsed
				? `展开 ${descendantCount} 条回复`
				: `收起 ${descendantCount} 条回复`,
		);
	};
	const dehydrateView = (view: OfflineView): void => {
		if (!view.hydrated) return;
		view.header.replaceChildren();
		view.content.replaceChildren();
		view.bodyLayer.replaceChildren();
		view.body.replaceChildren(view.content, view.bodyLayer);
		view.root.classList.remove('is-local-archive-post');
		view.root.classList.remove(
			'ldp-has-boosts',
			'ldp-has-reactions',
			'ldp-post-voting-answer',
		);
		view.root.dataset.ldpContentHydrated = '0';
		view.hydrated = false;
	};
	const projectView = (view: OfflineView): boolean => {
		if (view.hydrated) return false;
		const post = postByNumber.get(view.postNumber);
		if (!post) return false;
		const archived = unavailable.get(view.postNumber);
		const username = String(post.username || '');
		view.header.replaceChildren(
			avatar(post),
			userLink(
				'ldp-author',
				post.name || username || '未知用户',
				username,
			),
		);
		if (username) {
			view.header.append(userLink('ldp-user', `@${username}`, username));
		}
		if (
			username && ownerUsernameKey &&
			username.toLocaleLowerCase() === ownerUsernameKey
		) {
			view.header.append(textNode('ldp-op', 'OP'));
		}
		const created = relativeTime(post.created_at);
		if (created) {
			const time = document.createElement('span');
			time.className = 'ldp-time';
			time.dataset.exactTime = created.exact;
			time.title = created.exact;
			const label = textNode('ldp-time-relative', `· ${created.relative}`);
			time.append(label);
			view.header.append(time);
		}
		if (post.hidden === true && !archived) {
			view.header.append(textNode(
				'ldp-special-badge ldp-hidden-badge warn',
				'已隐藏',
			));
		}
		view.header.append(textNode(
			'ldp-floor ldp-body-floor',
			`#${view.postNumber}`,
		));
		view.content.innerHTML = String(post.cooked || '');
		prepareOfflineCooked(post, view.content);
		prepareReadOnlyPolls(post, view.content);
		view.bodyLayer.replaceChildren();
		view.body.replaceChildren(view.content, view.bodyLayer);
		if (archived) {
			view.root.classList.add('is-local-archive-post');
			const note = document.createElement('aside');
			note.className = 'ldp-post-local-archive-note';
			const confirmed = new Date(Number(archived.confirmedAt));
			note.textContent = [
				`本地缓存 · ${archiveStatusLabel(archived.status)}`,
				Number.isFinite(confirmed.getTime())
					? `${confirmed.toLocaleString()} 确认`
					: '',
			].filter(Boolean).join(' · ');
			if (post.hidden === true) {
				note.append(textNode(
					'ldp-post-local-archive-subtext',
					'（已隐藏）',
				));
			}
			view.bodyLayer.append(note);
		}
		prepareReadOnlySpecialContent(post, view);
		prepareReadOnlySolvedAnswers(post, view);
		prepareReadOnlyPostVoting(post, view);
		prepareReadOnlyBoosts(post, view, ownerUsername);
		if (!archived) prepareReadOnlyReactions(post, view);
		for (const cooked of view.body.querySelectorAll<HTMLElement>('.cooked')) {
			if (cooked !== view.content) prepareOfflineCooked(post, cooked, false);
		}
		prepareOfflineInlineEmoji(view.root);
		normalizeAssets(view.body);
		view.root.classList.remove('ldp-post-projection-pending');
		view.root.removeAttribute('aria-busy');
		view.root.dataset.ldpContentHydrated = '1';
		view.hydrated = true;
		return true;
	};
	const hydrateView = (view: OfflineView): boolean =>
		currentContentPostNumbers.has(view.postNumber) && projectView(view);
	const virtualSpacer = (blockSize: number): HTMLElement => {
		const spacer = document.createElement('div');
		spacer.className = 'ldp-tree-virtual-spacer';
		spacer.setAttribute('aria-hidden', 'true');
		spacer.style.blockSize = `${Math.max(0, blockSize)}px`;
		return spacer;
	};
	const rangeSize = (from: number, to: number): number => {
		const start = Math.max(0, from);
		const end = Math.min(visibleEntries.length, to);
		return end > start
			? Math.max(0, (prefix[end] ?? 0) - (prefix[start] ?? 0))
			: 0;
	};
	const measureViews = (): void => {
		const anchorIndex = firstEndingAfter(viewport.scrollTop);
		let compensation = 0;
		let changed = false;
		for (const postNumber of currentContentPostNumbers) {
			const view = views.get(postNumber);
			if (!view?.hydrated || !view.root.isConnected) continue;
			const rootSize = view.root.getBoundingClientRect().height;
			const replyTreeSize = view.replyTree.getBoundingClientRect().height;
			const measured = Math.round(rootSize - replyTreeSize);
			if (!Number.isFinite(measured) || measured <= 0) continue;
			const previous = ownSize(postNumber);
			if (previous === measured) continue;
			measuredOwnSizes.set(postNumber, measured);
			const index = visibleIndexByPost.get(postNumber);
			if (index !== undefined) {
				prefixDirtyFrom = Math.min(prefixDirtyFrom, index);
				if (index < anchorIndex) compensation += measured - previous;
			}
			changed = true;
		}
		if (!changed) return;
		ensurePrefix();
		if (compensation) viewport.scrollTop = Math.max(
			0,
			viewport.scrollTop + compensation,
		);
		scheduleRender(true);
	};
	const cancelHydration = (): void => {
		hydrationGeneration += 1;
		if (hydrationHandle === null) return;
		if (idleWindow.cancelIdleCallback) {
			idleWindow.cancelIdleCallback(hydrationHandle);
		} else {
			window.clearTimeout(hydrationHandle);
		}
		hydrationHandle = null;
	};
	const requestIdle = (
		callback: (deadline: OfflineIdleDeadline) => void,
	): number => idleWindow.requestIdleCallback
		? idleWindow.requestIdleCallback(callback, { timeout: 120 })
		: window.setTimeout(() => callback({
			didTimeout: true,
			timeRemaining: () => 0,
		}), 16);
	const queueHydration = (postNumbers: readonly number[]): void => {
		cancelHydration();
		const generation = hydrationGeneration;
		const queue = [...postNumbers];
		const run = (deadline: OfflineIdleDeadline): void => {
			hydrationHandle = null;
			if (generation !== hydrationGeneration) return;
			let hydrated = 0;
			while (
				queue.length && hydrated < 6 &&
				(hydrated < 1 || deadline.didTimeout || deadline.timeRemaining() > 4)
			) {
				const postNumber = queue.shift()!;
				const view = views.get(postNumber);
				if (view && hydrateView(view)) hydrated += 1;
			}
			if (hydrated) requestAnimationFrame(() => measureViews());
			if (queue.length && generation === hydrationGeneration) {
				hydrationHandle = requestIdle(run);
			}
		};
		if (queue.length) hydrationHandle = requestIdle(run);
	};
	const discussionLayer = document.createElement('div');
	discussionLayer.className = 'ldp-offline-discussion-layer';
	discussionLayer.hidden = true;
	discussionLayer.setAttribute('role', 'dialog');
	discussionLayer.setAttribute('aria-modal', 'true');
	const discussionWindow = document.createElement('section');
	discussionWindow.className = 'ldp-offline-discussion-window';
	const discussionHeader = document.createElement('header');
	discussionHeader.className = 'ldp-offline-discussion-header';
	const discussionClose = document.createElement('button');
	discussionClose.type = 'button';
	discussionClose.className = 'ldp-offline-discussion-close';
	discussionClose.append(offlineIcon('chevron-left'));
	discussionClose.setAttribute('aria-label', '关闭完整分支（Esc）');
	const discussionTitle = document.createElement('strong');
	discussionTitle.className = 'ldp-offline-discussion-title';
	const discussionTop = document.createElement('button');
	discussionTop.type = 'button';
	discussionTop.className = 'ldp-offline-discussion-top';
	discussionTop.append(offlineIcon('arrow-up'));
	discussionTop.setAttribute('aria-label', '回到完整分支顶部');
	const discussionList = document.createElement('div');
	discussionList.className =
		'ldp-offline-discussion-list ldp-segmented-branches';
	discussionHeader.append(discussionClose, discussionTitle, discussionTop);
	discussionWindow.append(discussionHeader, discussionList);
	discussionLayer.append(discussionWindow);
	offlineReader?.append(discussionLayer);
	const discussionViews = new Map<number, OfflineView>();
	const discussionCollapsed = new Set<number>();
	let discussionEntries: readonly OfflineEntry[] = Object.freeze([]);
	let discussionCursor = 0;
	let discussionReturnFocus: HTMLElement | null = null;

	const canonicalBranchEntries = (rootPostNumber: number): readonly OfflineEntry[] => {
		if (!postByNumber.has(rootPostNumber)) return Object.freeze([]);
		const branch: OfflineEntry[] = [];
		const pending: Array<Readonly<{
			postNumber: number;
			parentPostNumber: number | null;
			depth: number;
		}>> = [{ postNumber: rootPostNumber, parentPostNumber: null, depth: 0 }];
		while (pending.length) {
			const current = pending.pop()!;
			branch.push({ ...current, subtreeEndIndex: branch.length + 1 });
			const children = canonicalChildrenByNumber.get(current.postNumber) ?? [];
			for (let index = children.length - 1; index >= 0; index -= 1) {
				pending.push({
					postNumber: children[index]!,
					parentPostNumber: current.postNumber,
					depth: current.depth + 1,
				});
			}
		}
		const ends = subtreeEnds(branch);
		for (const entry of branch) {
			entry.subtreeEndIndex = ends.get(entry.postNumber) ?? branch.length;
		}
		return Object.freeze(branch);
	};
	/** 与在线“只看楼主”的完整讨论一致：回溯到主题正文 #1 下的首个祖先。 */
	const contextualDiscussionRoot = (targetPostNumber: number): number => {
		if (targetPostNumber === 1) return 1;
		let current = targetPostNumber;
		const seen = new Set<number>();
		while (!seen.has(current)) {
			seen.add(current);
			const parent = canonicalParentByNumber.get(current) ?? null;
			if (parent === null || parent === 1) return current;
			current = parent;
		}
		return targetPostNumber;
	};
	const syncDiscussionToggle = (
		view: OfflineView,
	): void => {
		const toggle = view.branchToggle;
		if (!toggle) return;
		const collapsed = discussionCollapsed.has(view.postNumber);
		view.replyList.hidden = collapsed;
		view.root.classList.toggle('ldp-branch-parent-collapsed', collapsed);
		positionBranchToggle(view, collapsed);
		renderBranchSymbol(toggle, collapsed);
		toggle.setAttribute('aria-expanded', String(!collapsed));
		toggle.setAttribute(
			'aria-label',
			`${collapsed ? '展开' : '收起'} #${view.postNumber} 的回复`,
		);
	};
	const appendDiscussionBatch = (): void => {
		discussionList.querySelector('[data-offline-discussion-more]')?.remove();
		const end = Math.min(discussionEntries.length, discussionCursor + 32);
		for (; discussionCursor < end; discussionCursor += 1) {
			const entry = discussionEntries[discussionCursor]!;
			const view = createView(entry, {
				children: canonicalChildrenByNumber,
				register: false,
				idPrefix: 'ldp-offline-discussion-post-',
				controlScope: 'discussion',
				showDiscussion: false,
			});
			view.root.classList.add('ldp-offline-discussion-post');
			view.root.dataset.ldpNestDepth = String(entry.depth);
			if (entry.depth > 0) {
				view.root.classList.add('ldp-nested-preview');
				const siblings = canonicalChildrenByNumber.get(
					entry.parentPostNumber!,
				) ?? [];
				view.root.classList.toggle(
					'ldp-segmented-branch-last',
					siblings.at(-1) === entry.postNumber,
				);
			}
			projectView(view);
			syncDiscussionToggle(view);
			discussionViews.set(entry.postNumber, view);
			const parent = entry.parentPostNumber === null
				? null
				: discussionViews.get(entry.parentPostNumber) ?? null;
			(parent?.replyList ?? discussionList).append(view.root);
		}
		if (discussionCursor < discussionEntries.length) {
			const more = document.createElement('button');
			more.type = 'button';
			more.className = 'ldp-offline-discussion-more';
			more.dataset.offlineDiscussionMore = '1';
			more.textContent = `继续加载（${discussionCursor}/${discussionEntries.length}）`;
			discussionList.append(more);
		}
	};
	const openDiscussion = (
		postNumber: number,
		returnFocus: HTMLElement | null,
		kind: 'branch' | 'context',
	): void => {
		const rootPostNumber = kind === 'context'
			? contextualDiscussionRoot(postNumber)
			: postNumber;
		discussionEntries = canonicalBranchEntries(rootPostNumber);
		if (!discussionEntries.length) return;
		discussionViews.clear();
		discussionCollapsed.clear();
		discussionCursor = 0;
		discussionList.replaceChildren();
		discussionTitle.textContent = kind === 'context'
			? `#${postNumber} · 查看完整讨论（${discussionEntries.length}）`
			: `#${postNumber} · 查看完整分支（${discussionEntries.length}）`;
		discussionLayer.dataset.offlineBranchRoot = String(rootPostNumber);
		discussionLayer.dataset.offlineDiscussionTarget = String(postNumber);
		discussionLayer.dataset.offlineDiscussionKind = kind;
		discussionReturnFocus = returnFocus;
		discussionLayer.hidden = false;
		appendDiscussionBatch();
		discussionList.scrollTop = 0;
		discussionClose.focus?.();
	};
	const closeDiscussion = (): void => {
		if (discussionLayer.hidden) return;
		discussionLayer.hidden = true;
		delete discussionLayer.dataset.offlineBranchRoot;
		delete discussionLayer.dataset.offlineDiscussionTarget;
		delete discussionLayer.dataset.offlineDiscussionKind;
		discussionList.replaceChildren();
		discussionEntries = Object.freeze([]);
		discussionViews.clear();
		discussionCollapsed.clear();
		discussionCursor = 0;
		discussionReturnFocus?.focus?.();
		discussionReturnFocus = null;
	};
	let highlightedPost: HTMLElement | null = null;
	const highlightOfflinePost = (target: HTMLElement | null): void => {
		if (!target) return;
		if (highlightedPost && highlightedPost !== target) {
			highlightedPost.classList.remove('ldp-offline-jump-highlight');
		}
		highlightedPost = target;
		target.classList.remove('ldp-offline-jump-highlight');
		target.classList.add('ldp-offline-jump-highlight');
		target.focus?.({ preventScroll: true });
		target.addEventListener('animationend', () => {
			if (highlightedPost === target) highlightedPost = null;
			target.classList.remove('ldp-offline-jump-highlight');
		}, { once: true });
	};
	const jumpToOfflinePost = (
		postNumber: number,
		returnFocus: HTMLElement | null,
	): void => {
		if (!postByNumber.has(postNumber)) return;
		if (!indexByPost.has(postNumber)) {
			openDiscussion(postNumber, returnFocus, 'context');
			while (
				!discussionViews.has(postNumber) &&
				discussionCursor < discussionEntries.length
			) appendDiscussionBatch();
			requestAnimationFrame(() => {
				const target = discussionList.querySelector<HTMLElement>(
					`[data-post-number="${postNumber}"]`,
				);
				target?.scrollIntoView?.({ block: 'start' });
				highlightOfflinePost(target);
			});
			return;
		}
		let parentPostNumber = parentByNumber.get(postNumber) ?? null;
		while (parentPostNumber !== null) {
			collapsedBranches.delete(parentPostNumber);
			parentPostNumber = parentByNumber.get(parentPostNumber) ?? null;
		}
		rebuildVisibleWindow();
		requestAnimationFrame(() => {
			ensurePrefix();
			const index = visibleIndexByPost.get(postNumber);
			if (index === undefined) return;
			viewport.scrollTop = Math.max(0, prefix[index] ?? 0);
			scheduleRender(true);
			requestAnimationFrame(() => {
				highlightOfflinePost(document.querySelector<HTMLElement>(
					`#post_${postNumber}`,
				));
			});
		});
	};
	const normalizeSearchValue = (value: unknown): string =>
		String(value ?? '').normalize('NFKC').toLocaleLowerCase().trim();
	let searchRecords: readonly OfflineSearchRecord[] | null = null;
	const readSearchRecords = (): readonly OfflineSearchRecord[] => {
		if (searchRecords) return searchRecords;
		const records = Object.freeze(posts.map((post: OfflinePost): OfflineSearchRecord => {
			const postNumber = Number(post.post_number);
			const postId = Number(post.id) || postNumber;
			const username = String(post.username || '');
			const name = String(post.name || '');
			const bodyText = String(
				post.offline_search_text ||
				String(post.cooked || '').replace(/<[^>]*>/g, ' '),
			)
				.replace(/\s+/g, ' ')
				.trim();
			const normalizedBodyText = normalizeSearchValue(bodyText);
			const searchText = normalizeSearchValue([
				`#${postNumber}`,
				`楼层 ${postNumber}`,
				`id:${postId}`,
				String(postId),
				username,
				username ? `@${username}` : '',
				name,
				bodyText,
			].join('\n'));
			return Object.freeze({
				postNumber,
				postId,
				username,
				name,
				bodyText,
				normalizedBodyText,
				searchText,
				compactSearchText: searchText.replace(/\s+/g, ''),
			});
		}));
		searchRecords = records;
		return records;
	};
	const setToolStatus = (message: string): void => {
		if (toolStatus) toolStatus.textContent = message;
	};
	let lastSearchPostNumbers: readonly number[] = Object.freeze([]);
	const hideSearchResults = (): void => {
		if (searchResults) {
			searchResults.hidden = true;
			searchResults.replaceChildren();
		}
		searchInput?.setAttribute('aria-expanded', 'false');
		lastSearchPostNumbers = Object.freeze([]);
	};
	const searchSnippet = (
		record: OfflineSearchRecord,
		normalizedQuery: string,
	): string => {
		if (!record.bodyText) return '（无正文文本）';
		const matchIndex = record.normalizedBodyText.indexOf(normalizedQuery);
		const start = matchIndex < 0 ? 0 : Math.max(0, matchIndex - 36);
		const text = record.bodyText.slice(start, start + 132);
		return `${start > 0 ? '…' : ''}${text}${
			start + 132 < record.bodyText.length ? '…' : ''
		}`;
	};
	const renderSearchResults = (): void => {
		if (!searchInput || !searchResults || !searchClear) return;
		const rawQuery = searchInput.value.trim();
		searchClear.hidden = rawQuery.length === 0;
		if (!rawQuery) {
			hideSearchResults();
			setToolStatus('');
			return;
		}
		const normalizedQuery = normalizeSearchValue(rawQuery);
		const compactQuery = normalizedQuery.replace(/\s+/g, '');
		const numericMatch = /^(?:#|id[:：]?)?\s*(\d+)$/i.exec(rawQuery);
		const numericQuery = numericMatch ? Number(numericMatch[1]) : null;
		const matches = readSearchRecords().flatMap((record) => {
			const exactFloor = numericQuery === record.postNumber;
			const exactId = numericQuery === record.postId;
			if (
				!exactFloor && !exactId &&
				!record.searchText.includes(normalizedQuery) &&
				!record.compactSearchText.includes(compactQuery)
			) return [];
			const normalizedUsername = normalizeSearchValue(record.username);
			const normalizedName = normalizeSearchValue(record.name);
			const score = exactFloor
				? 0
				: exactId
					? 1
					: normalizedUsername === normalizedQuery ||
							normalizedName === normalizedQuery
						? 2
						: record.normalizedBodyText.includes(normalizedQuery)
							? 3
							: 4;
			return [Object.freeze({ record, score })];
		}).sort((left, right) =>
			left.score - right.score ||
			left.record.postNumber - right.record.postNumber);
		const visible = matches.slice(0, 50);
		lastSearchPostNumbers = Object.freeze(visible.map(({ record }) =>
			record.postNumber));
		searchResults.replaceChildren();
		const summary = document.createElement('div');
		summary.className = 'ldp-offline-search-summary';
		summary.textContent = matches.length
			? `找到 ${matches.length} 个楼层${
				matches.length > visible.length ? ' · 显示前 50 个' : ''
			}`
			: '没有匹配的楼层';
		searchResults.append(summary);
		for (const { record } of visible) {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'ldp-offline-search-result';
			button.dataset.offlineSearchPost = String(record.postNumber);
			button.setAttribute('role', 'option');
			const heading = document.createElement('strong');
			heading.textContent = `#${record.postNumber} · ${
				record.username ? `@${record.username}` : '未知用户'
			}`;
			const identity = document.createElement('small');
			identity.className = 'ldp-offline-search-result-identity';
			identity.textContent = `ID ${record.postId}${
				record.name ? ` · ${record.name}` : ''
			}`;
			const snippet = document.createElement('span');
			snippet.className = 'ldp-offline-search-result-snippet';
			snippet.textContent = searchSnippet(record, normalizedQuery);
			button.append(heading, identity, snippet);
			searchResults.append(button);
		}
		searchResults.hidden = false;
		searchInput.setAttribute('aria-expanded', 'true');
		setToolStatus(matches.length
			? `搜索到 ${matches.length} 个楼层`
			: '没有匹配的楼层');
	};
	const selectSearchResult = (postNumber: number): void => {
		if (!postByNumber.has(postNumber)) return;
		hideSearchResults();
		setToolStatus(`已定位到楼层 #${postNumber}`);
		jumpToOfflinePost(postNumber, searchInput);
	};
	if (searchForm && searchInput && searchClear && searchResults) {
		searchInput.addEventListener('input', renderSearchResults);
		searchInput.addEventListener('focus', () => {
			if (searchInput.value.trim()) renderSearchResults();
		});
		searchInput.addEventListener('keydown', (event) => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			hideSearchResults();
		});
		searchClear.addEventListener('click', () => {
			searchInput.value = '';
			searchClear.hidden = true;
			hideSearchResults();
			setToolStatus('');
			searchInput.focus();
		});
		searchForm.addEventListener('submit', (event) => {
			event.preventDefault();
			renderSearchResults();
			const postNumber = lastSearchPostNumbers[0];
			if (postNumber) selectSearchResult(postNumber);
		});
		searchResults.addEventListener('click', (event) => {
			const target = event.target &&
				typeof (event.target as Element).closest === 'function'
				? event.target as Element
				: null;
			const result = target?.closest<HTMLButtonElement>(
				'[data-offline-search-post]',
			);
			if (!result) return;
			selectSearchResult(Number(result.dataset.offlineSearchPost));
		});
		document.addEventListener('click', (event) => {
			const target = event.target as Node | null;
			if (target && searchForm.parentElement?.contains(target)) return;
			hideSearchResults();
		});
	}
	if (jumpForm && jumpInput) {
		jumpForm.addEventListener('submit', (event) => {
			event.preventDefault();
			const match = /^\s*#?\s*(\d+)\s*$/.exec(jumpInput.value);
			const postNumber = match ? Number(match[1]) : 0;
			if (!Number.isSafeInteger(postNumber) || postNumber < 1) {
				jumpInput.setAttribute('aria-invalid', 'true');
				setToolStatus('请输入有效楼层号');
				return;
			}
			if (!postByNumber.has(postNumber)) {
				jumpInput.setAttribute('aria-invalid', 'true');
				setToolStatus(`离线正文中没有楼层 #${postNumber}`);
				return;
			}
			jumpInput.removeAttribute('aria-invalid');
			setToolStatus(`已定位到楼层 #${postNumber}`);
			jumpToOfflinePost(postNumber, jumpInput);
		});
		jumpInput.addEventListener('input', () => {
			jumpInput.removeAttribute('aria-invalid');
		});
	}
	const applyOnlyOpProjection = (active: boolean): void => {
		if (active && !onlyOpPostNumbers.length) {
			setToolStatus('离线正文无法识别楼主');
			return;
		}
		onlyOpActive = active;
		activeProjectionMode = onlyOpActive ? 'op' : downloadedProjectionMode;
		activeMainPostNumbers = onlyOpActive
			? onlyOpPostNumbers
			: downloadedMainPostNumbers;
		selectedProjection = activeMainPostNumbers !== null;
		projectionGraph = createProjectionGraph(activeMainPostNumbers);
		parentByNumber = projectionGraph.parentByNumber;
		childrenByNumber = projectionGraph.childrenByNumber;
		entries = projectionGraph.entries;
		indexByPost = projectionGraph.indexByPost;
		collapsedBranches = createCollapsedBranches();
		visibleEntries = entries.filter(branchVisible);
		visibleIndexByPost = new Map(visibleEntries.map(
			(entry, index) => [entry.postNumber, index],
		));
		visibleSubtreeEndByPost = subtreeEnds(visibleEntries);
		prefix = new Array<number>(visibleEntries.length + 1).fill(0);
		prefixDirtyFrom = 0;
		lastWindowKey = '';
		currentContentPostNumbers = new Set<number>();
		cancelHydration();
		closeDiscussion();
		hideSearchResults();
		if (highlightedPost) {
			highlightedPost.classList.remove('ldp-offline-jump-highlight');
			highlightedPost = null;
		}
		for (const view of views.values()) view.root.remove();
		views.clear();
		list.replaceChildren();
		before.style.blockSize = '0px';
		after.style.blockSize = '0px';
		viewport.scrollTop = 0;
		// 按钮状态与标题覆盖度已经明确反馈筛选结果，避免工具条再占一行。
		setToolStatus('');
		updateStatus();
		scheduleRender(true);
	};
	if (onlyOpToggle) {
		onlyOpToggle.addEventListener('click', () => {
			applyOnlyOpProjection(!onlyOpActive);
		});
		syncOnlyOpToggle();
	}
	const render = (force = false): void => {
		frame = 0;
		if (!visibleEntries.length) {
			before.style.blockSize = '0px';
			after.style.blockSize = '0px';
			list.replaceChildren();
			updateStatus();
			return;
		}
		ensurePrefix();
		const range = deriveWindowRange();
		const windowKey = `${range.start}:${range.end}`;
		if (!force && windowKey === lastWindowKey) return;
		lastWindowKey = windowKey;
		const contentEntries = visibleEntries.slice(range.start, range.end);
		const contentPostNumbers = new Set(
			contentEntries.map((entry) => entry.postNumber),
		);
		currentContentPostNumbers = contentPostNumbers;
		const mountedPostNumbers = new Set(contentPostNumbers);
		for (const entry of contentEntries) {
			let parentPostNumber = entry.parentPostNumber;
			while (parentPostNumber !== null) {
				if (mountedPostNumbers.has(parentPostNumber)) break;
				mountedPostNumbers.add(parentPostNumber);
				parentPostNumber = parentByNumber.get(parentPostNumber) ?? null;
			}
		}
		for (const [postNumber, view] of views) {
			if (mountedPostNumbers.has(postNumber)) continue;
			view.root.remove();
			views.delete(postNumber);
		}
		const mountedEntries = [...mountedPostNumbers]
			.map((postNumber) => visibleEntries[visibleIndexByPost.get(postNumber)!]!)
			.sort((left, right) =>
				visibleIndexByPost.get(left.postNumber)! -
					visibleIndexByPost.get(right.postNumber)!);
		for (const entry of mountedEntries) {
			const view = views.get(entry.postNumber) ?? createView(entry);
			view.root.dataset.postNumber = String(entry.postNumber);
			if (entry.parentPostNumber === null) {
				delete view.root.dataset.parentPostNumber;
				delete view.root.dataset.ldpNestDepth;
				view.root.classList.remove('ldp-nested-preview');
			} else {
				view.root.dataset.parentPostNumber = String(entry.parentPostNumber);
				view.root.dataset.ldpNestDepth = String(entry.depth);
				view.root.classList.add('ldp-nested-preview');
			}
			view.root.classList.remove('ldp-segmented-branch-last');
			view.root.style.setProperty(
				'--ldp-virtual-own-size',
				`${ownSize(entry.postNumber)}px`,
			);
			if (contentPostNumbers.has(entry.postNumber)) {
				view.root.classList.remove('ldp-virtual-ancestor-shell');
				if (!view.hydrated) {
					view.root.classList.add('ldp-post-projection-pending');
					view.root.setAttribute('aria-busy', 'true');
					view.root.dataset.ldpContentHydrated = '0';
				}
			} else {
				dehydrateView(view);
				view.root.classList.remove('ldp-post-projection-pending');
				view.root.classList.add('ldp-virtual-ancestor-shell');
				view.root.removeAttribute('aria-busy');
			}
			view.replyList.replaceChildren();
			view.root.classList.toggle(
				'ldp-has-child-branches',
				(childrenByNumber.get(entry.postNumber)?.length ?? 0) > 0,
			);
			syncBranchControls(view, entry);
		}
		const mountedChildren = new Map<number, number[]>();
		for (const entry of mountedEntries) {
			if (entry.parentPostNumber === null) continue;
			const children = mountedChildren.get(entry.parentPostNumber) ?? [];
			children.push(entry.postNumber);
			mountedChildren.set(entry.parentPostNumber, children);
		}
		for (const [parentPostNumber, children] of mountedChildren) {
			children.sort((left, right) =>
				visibleIndexByPost.get(left)! - visibleIndexByPost.get(right)!);
			const parentView = views.get(parentPostNumber);
			const parentIndex = visibleIndexByPost.get(parentPostNumber);
			if (!parentView || parentIndex === undefined) continue;
			parentView.root.classList.add('ldp-has-child-branches');
			let cursor = parentIndex + 1;
			let firstChildOffset = 0;
			const fragment = document.createDocumentFragment();
			children.forEach((childPostNumber, childIndex) => {
				const childIndexInEntries = visibleIndexByPost.get(childPostNumber)!;
				const beforeSize = rangeSize(cursor, childIndexInEntries);
				if (childIndex === 0) firstChildOffset = beforeSize;
				if (beforeSize > 0) fragment.append(virtualSpacer(beforeSize));
				const childView = views.get(childPostNumber);
				if (childView) {
					if (childIndex === children.length - 1) {
						childView.root.classList.add('ldp-segmented-branch-last');
					}
					fragment.append(childView.root);
				}
				cursor = visibleSubtreeEndByPost.get(childPostNumber) ??
					childIndexInEntries + 1;
			});
			const afterSize = rangeSize(
				cursor,
				visibleSubtreeEndByPost.get(parentPostNumber) ?? parentIndex + 1,
			);
			if (afterSize > 0) fragment.append(virtualSpacer(afterSize));
			parentView.replyList.append(fragment);
			parentView.branchToggle?.style.setProperty(
				'--ldp-offline-branch-anchor-offset',
				`${firstChildOffset}px`,
			);
		}
		const mountedRoots = mountedEntries.filter(
			(entry) => entry.parentPostNumber === null,
		);
		list.replaceChildren(...mountedRoots.map((entry) =>
			views.get(entry.postNumber)!.root));
		ensurePrefix();
		const mountedStart = mountedRoots.length
			? visibleIndexByPost.get(mountedRoots[0]!.postNumber) ?? range.start
			: range.start;
		const mountedEnd = mountedRoots.reduce((end, entry) => Math.max(
			end,
			visibleSubtreeEndByPost.get(entry.postNumber) ??
				(visibleIndexByPost.get(entry.postNumber) ?? end) + 1,
		), range.end);
		before.style.blockSize = `${prefix[mountedStart] ?? 0}px`;
		after.style.blockSize = `${Math.max(
			0,
			(prefix.at(-1) ?? 0) - (prefix[mountedEnd] ?? 0),
		)}px`;
		const visiblePostNumbers = visibleEntries
			.slice(range.visibleStart, range.visibleEnd)
			.map((entry) => entry.postNumber)
			.filter((postNumber) => contentPostNumbers.has(postNumber));
		for (const postNumber of visiblePostNumbers) {
			const view = views.get(postNumber);
			if (view) hydrateView(view);
		}
		const visibleCenter = (range.visibleStart + range.visibleEnd) / 2;
		const nearbyPostNumbers = contentEntries
			.filter((entry) => !visiblePostNumbers.includes(entry.postNumber))
			.sort((left, right) =>
				Math.abs(visibleIndexByPost.get(left.postNumber)! - visibleCenter) -
				Math.abs(visibleIndexByPost.get(right.postNumber)! - visibleCenter))
			.map((entry) => entry.postNumber);
		queueHydration(nearbyPostNumbers);
		requestAnimationFrame(() => measureViews());
		updateStatus();
	};

	viewport.addEventListener('scroll', () => {
		exactTimeTooltip.hidden = true;
		exactTimeTooltip.textContent = '';
		scheduleRender();
	}, { passive: true });
	discussionList.addEventListener('scroll', () => {
		if (
			discussionCursor < discussionEntries.length &&
			discussionList.scrollTop + discussionList.clientHeight >=
				discussionList.scrollHeight - 480
		) appendDiscussionBatch();
	}, { passive: true });
	window.addEventListener('resize', () => {
		exactTimeTooltip.hidden = true;
		exactTimeTooltip.textContent = '';
		scheduleRender(true);
	}, { passive: true });
	document.addEventListener('toggle', () => scheduleRender(true), true);
	document.addEventListener('click', (event) => {
		const target = event.target &&
			typeof (event.target as Element).closest === 'function'
			? event.target as Element
			: null;
		const exactTime = target?.closest<HTMLElement>(
			'.ldp-time[data-exact-time]',
		) ?? null;
		if (exactTime) {
			const exact = String(exactTime.dataset.exactTime ?? '').trim();
			exactTime.removeAttribute('title');
			exactTimeTooltip.textContent = exact;
			exactTimeTooltip.hidden = !exact;
			const targetRect = exactTime.getBoundingClientRect();
			const tooltipRect = exactTimeTooltip.getBoundingClientRect();
			const edge = 8;
			const width = Math.max(0, tooltipRect.width);
			const height = Math.max(0, tooltipRect.height);
			const left = Math.max(
				edge,
				Math.min(
					targetRect.left + (targetRect.width - width) / 2,
					window.innerWidth - width - edge,
				),
			);
			let top = targetRect.top - height - 6;
			if (top < edge) {
				top = Math.min(
					window.innerHeight - height - edge,
					targetRect.bottom + 6,
				);
			}
			exactTimeTooltip.style.left = `${Math.round(left)}px`;
			exactTimeTooltip.style.top = `${Math.round(Math.max(edge, top))}px`;
			return;
		}
		exactTimeTooltip.hidden = true;
		exactTimeTooltip.textContent = '';
		const calloutToggle = target?.closest<HTMLButtonElement>(
			'[data-reader-callout-action="toggle"]',
		) ?? null;
		if (calloutToggle) {
			event.preventDefault();
			event.stopPropagation();
			const quote = calloutToggle.closest<HTMLElement>('.ldp-callout');
			const body = quote?.querySelector<HTMLElement>(
				':scope > .ldp-callout-body',
			);
			if (!quote || !body) return;
			const expanded = calloutToggle.getAttribute('aria-expanded') !== 'true';
			body.hidden = !expanded;
			quote.classList.toggle('ldp-callout--collapsed', !expanded);
			calloutToggle.setAttribute('aria-expanded', String(expanded));
			calloutToggle.setAttribute(
				'aria-label',
				expanded ? '收起提示内容' : '展开提示内容',
			);
			calloutToggle.replaceChildren(offlineIcon(
				expanded ? 'chevron-up' : 'chevron-down',
			));
			scheduleRender(true);
			return;
		}
		const quoteToggle = target?.closest<HTMLButtonElement>(
			'[data-offline-quote-toggle]',
		) ?? null;
		if (quoteToggle) {
			event.preventDefault();
			event.stopPropagation();
			const quote = quoteToggle.closest<HTMLElement>('.ldp-post-quote');
			const body = quote?.querySelector<HTMLElement>(':scope > blockquote');
			const key = String(quoteToggle.dataset.offlineQuoteToggle || '');
			const targetPostNumber = Number(quoteToggle.dataset.targetPostNumber);
			const targetTopicId = Number(quoteToggle.dataset.targetTopicId);
			const targetPost = quotedPost(targetTopicId, targetPostNumber);
			if (!quote || !body || !key || !targetPost) return;
			const expanded = expandedQuoteKeys.has(key);
			if (expanded) {
				expandedQuoteKeys.delete(key);
				const excerpt = quoteExcerptHtmlByElement.get(quote);
				if (excerpt !== undefined) body.innerHTML = excerpt;
				delete quote.dataset.ldpQuoteHydrated;
				prepareOfflineQuoteImages(body);
				quote.classList.remove('ldp-quote-expanded');
				quote.dataset.ldpQuoteExpanded = '0';
				quoteToggle.setAttribute('aria-expanded', 'false');
				quoteToggle.setAttribute('aria-label', '展开完整引用');
				quoteToggle.replaceChildren(offlineIcon('chevron-down'));
			} else {
				body.innerHTML = String(targetPost.cooked || '');
				quote.dataset.ldpQuoteHydrated = '1';
				prepareOfflineCooked(targetPost, body);
				expandedQuoteKeys.add(key);
				quote.classList.add('ldp-quote-expanded');
				quote.dataset.ldpQuoteExpanded = '1';
				quoteToggle.setAttribute('aria-expanded', 'true');
				quoteToggle.setAttribute('aria-label', '收起引用');
				quoteToggle.replaceChildren(offlineIcon('chevron-up'));
			}
			normalizeAssets(body);
			scheduleRender(true);
			return;
		}
		const quoteJump = target?.closest<HTMLAnchorElement>(
			'[data-offline-quote-jump]',
		) ?? null;
		if (quoteJump) {
			const targetPostNumber = Number(quoteJump.dataset.offlineQuoteJump);
			const targetTopicId = Number(quoteJump.dataset.targetTopicId);
			if (
				targetTopicId === Number(data.topicId) &&
				postByNumber.has(targetPostNumber)
			) {
				event.preventDefault();
				event.stopPropagation();
				jumpToOfflinePost(targetPostNumber, quoteJump);
				return;
			}
		}
		const toggle = target?.closest<HTMLButtonElement>(
			'[data-offline-branch-toggle]',
		) ?? null;
		if (toggle) {
			const postNumber = Number(toggle.dataset.offlineBranchToggle);
			if (toggle.dataset.offlineBranchScope === 'discussion') {
				const view = discussionViews.get(postNumber);
				const entry = discussionEntries.find((candidate) =>
					candidate.postNumber === postNumber);
				if (!view || !entry) return;
				if (discussionCollapsed.has(postNumber)) {
					discussionCollapsed.delete(postNumber);
				} else {
					discussionCollapsed.add(postNumber);
				}
				syncDiscussionToggle(view);
				return;
			}
			if (!indexByPost.has(postNumber)) return;
			if (collapsedBranches.has(postNumber)) {
				collapsedBranches.delete(postNumber);
			} else {
				collapsedBranches.add(postNumber);
			}
			rebuildVisibleWindow();
			return;
		}
		const discussion = target?.closest<HTMLButtonElement>(
			'[data-offline-branch-discussion]',
		) ?? null;
		if (discussion) {
			openDiscussion(
				Number(discussion.dataset.offlineBranchDiscussion),
				discussion,
				discussion.dataset.offlineDiscussionKind === 'context'
					? 'context'
					: 'branch',
			);
			return;
		}
		if (target?.closest('[data-offline-discussion-more]')) {
			appendDiscussionBatch();
			return;
		}
		if (target?.closest('.ldp-offline-discussion-close')) {
			closeDiscussion();
			return;
		}
		if (target?.closest('.ldp-offline-discussion-top')) {
			discussionList.scrollTop = 0;
		}
	});
	document.addEventListener('keydown', (event) => {
		if (event.key !== 'Escape' || discussionLayer.hidden) return;
		event.preventDefault();
		closeDiscussion();
	});
	document.getElementById('ldp-offline-title')?.addEventListener('click', () => {
		if (typeof viewport.scrollTo === 'function') {
			viewport.scrollTo({ top: 0, behavior: 'smooth' });
		} else {
			viewport.scrollTop = 0;
		}
	});
	const overlay = document.querySelector<HTMLElement>('[data-offline-reader]');
	if (overlay) overlay.dataset.ldpTheme = data.theme === 'dark' ? 'dark' : 'light';
	prepareOfflineInlineEmoji(offlineReader);
	render(true);
	offlineReader.dataset.offlineHydrated = '1';
}

/**
 * Blob 页面会继承宿主 CSP，内联脚本可能被阻止；由 Reader 在新标签 load 后
 * 直接把同一离线运行时投影到目标 Window，下载到磁盘的 HTML 仍保留自执行脚本。
 */
export function hydrateReaderTopicOfflineDocumentWindow(
	targetWindow: Window,
): void {
	const requestFrame = typeof targetWindow.requestAnimationFrame === 'function'
		? targetWindow.requestAnimationFrame.bind(targetWindow)
		: (callback: FrameRequestCallback) => targetWindow.setTimeout(
			() => callback(targetWindow.performance?.now() ?? Date.now()),
			16,
		);
	const cancelFrame = typeof targetWindow.cancelAnimationFrame === 'function'
		? targetWindow.cancelAnimationFrame.bind(targetWindow)
		: (handle: number) => targetWindow.clearTimeout(handle);
	readerTopicOfflineRuntime({
		document: targetWindow.document,
		window: targetWindow,
		location: targetWindow.location,
		URL: globalThis.URL,
		requestAnimationFrame: requestFrame,
		cancelAnimationFrame: cancelFrame,
	});
}

const OFFLINE_STYLES = String.raw`
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
body { background: #fff; font-family: system-ui, sans-serif; }
[data-offline-reader] img.ldp-offline-inline-emoji {
	display: inline-block;
	width: 1.25em;
	height: 1.25em;
	margin: 0 .08em;
	object-fit: contain;
	vertical-align: -.26em;
}
[data-offline-reader].ldp-overlay {
	--ldp-window-capsule-rail: 0px;
	--ldp-offline-content-width: min(1440px, 76vw);
	--ldp-offline-page-gutter: max(
		20px,
		calc((100vw - var(--ldp-offline-content-width)) / 2)
	);
	background: var(--ldp-canvas, #fff);
	pointer-events: auto;
}
[data-offline-reader] .ldp-header {
	--ldp-header-reserved-right: var(--ldp-offline-page-gutter);
	display: grid;
	min-height: 0;
	grid-template-columns:
		var(--ldp-home-logo-box-size)
		minmax(0, 1fr)
		minmax(420px, 560px);
	grid-template-rows: auto auto auto;
	column-gap: 14px;
	row-gap: 1px;
	padding-right: var(--ldp-offline-page-gutter);
	padding-left: var(--ldp-offline-page-gutter);
}
[data-offline-reader] .ldp-header > .ldp-home-logo {
	grid-column: 1;
	grid-row: 1 / 4;
	align-self: center;
}
[data-offline-reader] .ldp-header > .ldp-title-wrap,
[data-offline-reader] .ldp-header .ldp-title-subline {
	display: contents;
}
[data-offline-reader].ldp-overlay.ldp-fullpage .ldp-header .ldp-title {
	grid-column: 2;
	grid-row: 1;
}
[data-offline-reader] .ldp-header .ldp-meta-row {
	grid-column: 2;
	grid-row: 2;
}
[data-offline-reader] .ldp-header .ldp-title-topic-row {
	grid-column: 2;
	grid-row: 3;
}
[data-offline-reader] .ldp-offline-logo-fallback {
	display: block;
	width: var(--ldp-home-logo-size);
	height: var(--ldp-home-logo-size);
	border-radius: 50%;
	background: linear-gradient(#16181b 0 50%, #f7b93d 50% 100%);
}
[data-offline-reader] .ldp-offline-status::before { content: " · "; }
[data-offline-reader] .ldp-offline-status:empty { display: none; }
[data-offline-reader] .ldp-reader-main {
	min-height: 0;
	grid-template-columns:
		minmax(var(--ldp-offline-page-gutter), 1fr)
		minmax(0, var(--ldp-offline-content-width))
		minmax(var(--ldp-offline-page-gutter), 1fr);
}
[data-offline-reader] #ldp-offline-viewport {
	overflow-y: auto;
	scrollbar-gutter: stable;
}
[data-offline-reader] .ldp-topic-runtime {
	min-height: 100%;
	padding-top: 8px;
	padding-bottom: 48px;
}
[data-offline-reader] .ldp-offline-tools {
	position: relative;
	z-index: 10;
	display: grid;
	width: 100%;
	min-width: 0;
	grid-column: 3;
	grid-row: 1 / 4;
	grid-template-columns: minmax(240px, 1fr) auto auto;
	align-self: center;
	align-items: center;
	gap: 4px 0;
	padding: 2px 5px;
	border: 1px solid color-mix(
		in srgb,
		var(--ldp-border, #d9dde3) 62%,
		transparent
	);
	border-radius: 8px;
	background: color-mix(
		in srgb,
		var(--ldp-surface-muted, #edf0f4) 42%,
		transparent
	);
}
[data-offline-reader] .ldp-offline-search-wrap {
	position: relative;
	min-width: 0;
}
[data-offline-reader] .ldp-offline-search,
[data-offline-reader] .ldp-offline-jump-field {
	position: relative;
	display: flex;
	min-width: 0;
	align-items: center;
	border: 0;
	border-radius: 7px;
	background: transparent;
	color: var(--ldp-ink, #20242a);
}
[data-offline-reader] .ldp-offline-search:focus-within,
[data-offline-reader] .ldp-offline-jump-field:focus-within {
	background: color-mix(
		in srgb,
		var(--ldp-surface-raised, var(--ldp-canvas, #fff)) 72%,
		transparent
	);
	box-shadow: inset 0 0 0 1px color-mix(
		in srgb,
		var(--tertiary, #0f79bf) 34%,
		transparent
	);
}
[data-offline-reader] .ldp-offline-tool-icon {
	position: absolute;
	left: 8px;
	z-index: 1;
	display: inline-flex;
	width: 14px;
	height: 14px;
	color: var(--ldp-ink-muted, #6d7580);
	pointer-events: none;
}
[data-offline-reader] .ldp-offline-tool-icon > .ldp-icon,
[data-offline-reader] .ldp-offline-search-clear > .ldp-icon,
[data-offline-reader] .ldp-offline-only-op > .ldp-icon,
[data-offline-reader] .ldp-offline-jump-form button > .ldp-icon {
	width: 14px;
	height: 14px;
}
[data-offline-reader] .ldp-offline-search input,
[data-offline-reader] .ldp-offline-jump-field input {
	width: 100%;
	height: 28px;
	min-width: 0;
	border: 0;
	outline: 0;
	background: transparent;
	color: inherit;
	font: inherit;
}
[data-offline-reader] .ldp-offline-search input {
	padding: 0 30px 0 29px;
}
[data-offline-reader] .ldp-offline-search-clear {
	position: absolute;
	right: 2px;
	display: inline-grid;
	width: 24px;
	height: 24px;
	padding: 4px;
	place-items: center;
	border: 0;
	border-radius: 5px;
	background: transparent;
	color: var(--ldp-ink-muted, #6d7580);
	cursor: pointer;
}
[data-offline-reader] .ldp-offline-search-clear[hidden] { display: none; }
[data-offline-reader] .ldp-offline-search-clear:hover {
	background: var(--ldp-surface-muted, #edf0f4);
	color: var(--ldp-ink, #20242a);
}
[data-offline-reader] .ldp-offline-search-results {
	position: absolute;
	top: calc(100% + 5px);
	right: 0;
	left: 0;
	z-index: 12;
	display: grid;
	max-height: min(460px, 55vh);
	overflow-y: auto;
	padding: 5px;
	border: 1px solid var(--ldp-border, #cfd4dc);
	border-radius: 10px;
	background: var(--ldp-surface-raised, var(--ldp-canvas, #fff));
	box-shadow: 0 12px 32px rgba(0, 0, 0, .2);
}
[data-offline-reader] .ldp-offline-search-results[hidden] { display: none; }
[data-offline-reader] .ldp-offline-search-summary {
	position: sticky;
	top: -5px;
	z-index: 1;
	padding: 7px 9px;
	background: inherit;
	color: var(--ldp-ink-muted, #6d7580);
	font-size: var(--ldp-font-xs, 12px);
}
[data-offline-reader] .ldp-offline-search-result {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	gap: 2px 10px;
	padding: 8px 9px;
	border: 0;
	border-radius: 8px;
	background: transparent;
	color: inherit;
	cursor: pointer;
	font: inherit;
	text-align: left;
}
[data-offline-reader] .ldp-offline-search-result:hover,
[data-offline-reader] .ldp-offline-search-result:focus-visible {
	outline: 0;
	background: var(--ldp-surface-muted, #edf0f4);
}
[data-offline-reader] .ldp-offline-search-result-identity {
	align-self: center;
	color: var(--ldp-ink-muted, #6d7580);
}
[data-offline-reader] .ldp-offline-search-result-snippet {
	grid-column: 1 / -1;
	overflow: hidden;
	color: var(--ldp-ink-muted, #6d7580);
	font-size: var(--ldp-font-sm, 13px);
	line-height: 1.4;
	text-overflow: ellipsis;
	white-space: nowrap;
}
[data-offline-reader] .ldp-offline-only-op {
	position: relative;
	display: inline-flex;
	height: 28px;
	align-items: center;
	justify-content: center;
	gap: 3px;
	margin-left: 7px;
	padding: 0 6px;
	border: 0;
	border-radius: 6px;
	background: transparent;
	color: var(--ldp-ink-muted, #6d7580);
	cursor: pointer;
	font-family: inherit;
	font-size: var(--ldp-reader-title-font-size, var(--ldp-font-xl, 16px));
	font-weight: 520;
	line-height: 1;
	white-space: nowrap;
}
[data-offline-reader] .ldp-offline-only-op::before {
	position: absolute;
	top: 5px;
	bottom: 5px;
	left: -7px;
	width: 1px;
	background: color-mix(
		in srgb,
		var(--ldp-border, #cfd4dc) 76%,
		transparent
	);
	content: "";
}
[data-offline-reader] .ldp-offline-only-op:hover,
[data-offline-reader] .ldp-offline-only-op:focus-visible {
	outline: 0;
	background: color-mix(
		in srgb,
		var(--ldp-surface-raised, var(--ldp-canvas, #fff)) 74%,
		transparent
	);
	color: var(--ldp-ink, #20242a);
	box-shadow: inset 0 0 0 1px color-mix(
		in srgb,
		var(--tertiary, #0f79bf) 28%,
		transparent
	);
}
[data-offline-reader] .ldp-offline-only-op.active {
	background: color-mix(
		in srgb,
		var(--tertiary-low, #d8ecf8) 62%,
		transparent
	);
	color: var(--tertiary, #0f79bf);
	box-shadow: none;
}
[data-offline-reader] .ldp-offline-only-op:disabled {
	cursor: not-allowed;
	opacity: .48;
}
[data-offline-reader] .ldp-offline-jump-form {
	position: relative;
	display: flex;
	align-items: center;
	gap: 2px;
	margin-left: 7px;
	padding-left: 7px;
	border-left: 1px solid color-mix(
		in srgb,
		var(--ldp-border, #cfd4dc) 76%,
		transparent
	);
}
[data-offline-reader] .ldp-offline-jump-field {
	width: 84px;
	padding-left: 5px;
	color: var(--ldp-ink-muted, #6d7580);
}
[data-offline-reader] .ldp-offline-jump-field input {
	padding: 0 5px 0 3px;
	color: var(--ldp-ink, #20242a);
}
[data-offline-reader] .ldp-offline-jump-form > button {
	display: inline-flex;
	height: 28px;
	align-items: center;
	gap: 3px;
	padding: 0 6px;
	border: 0;
	border-radius: 6px;
	background: transparent;
	color: var(--tertiary, #0f79bf);
	cursor: pointer;
	font-family: inherit;
	font-size: var(--ldp-reader-title-font-size, var(--ldp-font-xl, 16px));
	font-weight: 520;
	line-height: 1;
}
[data-offline-reader] .ldp-offline-jump-form > button:hover,
[data-offline-reader] .ldp-offline-jump-form > button:focus-visible {
	outline: 0;
	background: color-mix(
		in srgb,
		var(--tertiary-low, #d8ecf8) 54%,
		transparent
	);
	box-shadow: inset 0 0 0 1px color-mix(
		in srgb,
		var(--tertiary, #0f79bf) 24%,
		transparent
	);
}
[data-offline-reader] .ldp-offline-tool-status {
	grid-column: 1 / -1;
	min-height: 0;
	margin: 0 5px 1px;
	color: var(--ldp-ink-muted, #6d7580);
	font-size: var(--ldp-font-xs, 12px);
}
[data-offline-reader] .ldp-offline-tool-status:empty { display: none; }
@keyframes ldp-offline-jump-pulse {
	0%, 100% { box-shadow: 0 0 0 0 transparent; }
	20%, 70% {
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--tertiary, #0f79bf) 24%, transparent);
	}
}
[data-offline-reader] .ldp-post.ldp-offline-jump-highlight {
	outline: 2px solid var(--tertiary, #0f79bf);
	outline-offset: 3px;
	animation: ldp-offline-jump-pulse 1.8s ease-out;
}
[data-offline-reader] .ldp-avatar-link { cursor: default; }
[data-offline-reader] .ldp-title-jump { cursor: pointer; }
[data-offline-reader] .ldp-offline-branch-toggle {
	--ldp-offline-branch-control-size: 16px;
	z-index: 4;
	display: grid;
	width: var(--ldp-offline-branch-control-size);
	height: var(--ldp-offline-branch-control-size);
}
[data-offline-reader] .ldp-offline-branch-toggle[hidden] {
	display: none !important;
}
[data-offline-reader].ldp-overlay
.ldp-segmented-branches .ldp-post > .ldp-reply-tree >
.ldp-offline-branch-first-child-anchor[aria-expanded="true"] {
	/*
	 * 直属子楼头像从 5px 开始；符号中心固定在其上方 10px。
	 * 宿主子楼自身收起时，通用收起行会用 !important 清空 inset；这里必须
	 * 继续由父分支锚点胜出，否则父级“−”会与子楼自己的“+”叠在一起。
	 */
	top: calc(
		var(--ldp-offline-branch-anchor-offset, 0px) + 5px - 10px
	) !important;
	left: calc(var(--ldp-thread-avatar-size) / -2) !important;
	position: absolute;
	translate: -50% -50%;
}
[data-offline-reader] .ldp-offline-branch-symbol {
	display: block;
	width: 12px;
	height: 12px;
	stroke-width: 2;
}
[data-offline-reader] .ldp-offline-boost-bubble {
	cursor: default;
}
[data-offline-reader] .ldp-offline-boost-bubble .ldp-boost-avatar-link {
	cursor: pointer;
}
[data-offline-reader] .ldp-offline-reaction-chip {
	cursor: default;
}
[data-offline-reader] .ldp-offline-topic-vote {
	cursor: default;
}
[data-offline-reader] .ldp-offline-pv-votes {
	gap: 2px;
	color: var(--ldp-ink-muted);
}
[data-offline-reader] .ldp-offline-pv-label,
[data-offline-reader] .ldp-offline-pv-comments-title {
	font-size: var(--ldp-font-xs, 11px);
}
[data-offline-reader] .ldp-offline-pv-comments-title {
	display: block;
	padding: 8px 0 2px;
}
[data-offline-reader] .ldp-offline-solved-floor {
	cursor: default;
}
[data-offline-reader] .ldp-offline-branch-discussion,
[data-offline-reader] .ldp-offline-discussion-more {
	position: relative;
	z-index: 1;
	align-items: center;
	gap: 5px;
	min-height: 22px;
	padding: 2px 8px;
	border: 0;
	border-radius: 999px;
	background: var(--ldp-accent-soft, #e6f2e9);
	color: var(--ldp-accent, #47855f);
	cursor: pointer;
	font: 650 var(--ldp-font-xs, 11px)/1.2 system-ui, sans-serif;
}
[data-offline-reader] .ldp-offline-branch-discussion {
	display: inline-flex;
}
[data-offline-reader] .ldp-offline-branch-discussion > .ldp-icon {
	width: 14px;
	height: 14px;
}
[data-offline-reader] .ldp-offline-branch-discussion:is(:hover,:focus-visible) {
	background: color-mix(in srgb, var(--ldp-accent, #47855f) 16%, transparent);
}
[data-offline-reader] .ldp-offline-context-discussion {
	display: flex;
	width: max-content;
	margin: 6px auto 8px;
}
[data-offline-reader] .ldp-virtual-ancestor-shell > :is(
	.ldp-offline-branch-toggle:not(.ldp-offline-branch-first-child-anchor),
	.ldp-offline-branch-discussion
) {
	display: none;
}
[data-offline-reader] .ldp-offline-discussion-layer[hidden] {
	display: none !important;
}
[data-offline-reader] .ldp-offline-discussion-layer {
	position: absolute;
	inset: 0;
	z-index: 80;
	display: grid;
	place-items: center;
	padding: 24px;
	background: rgb(0 0 0 / 24%);
	pointer-events: auto;
}
[data-offline-reader] .ldp-offline-discussion-window {
	display: grid;
	width: min(1600px, calc(100vw - 48px));
	height: min(88vh, 900px);
	grid-template-rows: auto minmax(0, 1fr);
	overflow: hidden;
	border: 1px solid var(--ldp-divider-line-color, #ddd);
	border-radius: 14px;
	background: var(--ldp-canvas, #fff);
	box-shadow: 0 20px 70px rgb(0 0 0 / 28%);
}
[data-offline-reader] .ldp-offline-discussion-header {
	display: grid;
	grid-template-columns: 34px minmax(0, 1fr) 34px;
	align-items: center;
	gap: 8px;
	min-height: 46px;
	padding: 6px 10px;
	border-bottom: 1px solid var(--ldp-divider-line-color, #ddd);
}
[data-offline-reader] :is(
	.ldp-offline-discussion-close,
	.ldp-offline-discussion-top
) {
	display: inline-grid;
	width: 32px;
	height: 32px;
	place-items: center;
	padding: 0;
	border: 0;
	border-radius: 8px;
	background: transparent;
	color: var(--ldp-ink-muted, #69737d);
	cursor: pointer;
	font: 700 20px/1 system-ui, sans-serif;
}
[data-offline-reader] :is(
	.ldp-offline-discussion-close,
	.ldp-offline-discussion-top
) > .ldp-icon {
	width: 20px;
	height: 20px;
}
[data-offline-reader] .ldp-offline-discussion-title {
	overflow: hidden;
	text-align: center;
	text-overflow: ellipsis;
	white-space: nowrap;
}
[data-offline-reader] .ldp-offline-discussion-list {
	min-height: 0;
	padding: 14px 18px 40px;
	overflow: auto;
	overscroll-behavior: contain;
}
[data-offline-reader] .ldp-offline-discussion-post {
	content-visibility: auto;
	contain-intrinsic-block-size: auto 260px;
}
/* segmented 子回复线会伸出楼层自身边界；浮窗内禁用 paint containment，避免线段在减号后被裁断。 */
[data-offline-reader]
	.ldp-offline-discussion-list.ldp-segmented-branches
	.ldp-offline-discussion-post {
	content-visibility: visible;
}
[data-offline-reader] .ldp-offline-discussion-more {
	display: block;
	margin: 16px auto 0;
}
[data-offline-reader] .ldp-content :is(img,video,iframe) {
	max-width: 100%;
	height: auto;
}
[data-offline-reader] .ldp-offline-image-frame {
	--ldp-offline-image-scale: 50%;
	position: relative;
	display: block;
	width: 100%;
	max-width: none;
	margin-block: 8px;
	outline: none;
}
[data-offline-reader] .ldp-offline-image-frame > :is(a,picture,img) {
	display: block;
	width: var(--ldp-offline-image-scale);
	max-width: none;
	cursor: pointer;
	transition: width var(--ldp-motion-fast, 120ms) ease-out;
}
[data-offline-reader] .ldp-offline-image-frame > :is(a,picture) img {
	display: block;
	width: 100%;
	max-width: none;
	height: auto;
}
[data-offline-reader] .ldp-offline-image-frame [data-offline-image-error] {
	min-width: 80px;
	min-height: 42px;
	background: var(--ldp-surface-muted, #eef1f5);
}
@media (max-width: 700px) {
	[data-offline-reader].ldp-overlay {
		--ldp-offline-content-width: calc(100vw - 24px);
		--ldp-offline-page-gutter: 12px;
	}
	[data-offline-reader] .ldp-offline-discussion-layer { padding: 8px; }
	[data-offline-reader] .ldp-offline-discussion-window {
		width: calc(100vw - 16px);
		height: calc(100vh - 16px);
	}
	[data-offline-reader] .ldp-header {
		grid-template-columns: var(--ldp-home-logo-box-size) minmax(0, 1fr);
		grid-template-rows: auto auto auto auto;
		column-gap: 8px;
		padding-right: var(--ldp-offline-page-gutter);
		padding-left: var(--ldp-offline-page-gutter);
	}
	[data-offline-reader] .ldp-offline-tools {
		grid-column: 1 / -1;
		grid-row: 4;
		grid-template-columns: minmax(0, 1fr);
		padding: 7px;
	}
	[data-offline-reader] .ldp-offline-only-op {
		width: 100%;
		margin-left: 0;
	}
	[data-offline-reader] .ldp-offline-only-op::before {
		display: none;
	}
	[data-offline-reader] .ldp-offline-jump-form {
		margin-left: 0;
		padding-left: 0;
		border-left: 0;
		justify-content: flex-end;
	}
	[data-offline-reader] .ldp-offline-jump-field {
		width: min(180px, 100%);
		flex: 1;
	}
	[data-offline-reader] .ldp-offline-search-results {
		max-height: 48vh;
	}
}
@media (prefers-reduced-motion: reduce) {
	[data-offline-reader] .ldp-post.ldp-offline-jump-highlight {
		animation: none;
	}
}
`;

/** 生成只保留阅读投影、数据与虚拟树运行时的单 HTML。 */
export function createReaderTopicOfflineDocument<
	TTopic extends DiscourseTopicPayload<TPost>,
	TPost extends DiscourseTopicPostInput,
>(input: ReaderTopicOfflineDocumentInput<TTopic, TPost>): ReaderTopicOfflineDocument {
	const topicId = Number(input.topicId);
	if (!Number.isSafeInteger(topicId) || topicId < 1) {
		throw new RangeError('离线 Topic id 必须是正安全整数');
	}
	const unique = new Map<number, ReaderOfflinePost>();
	for (const rawPost of input.posts) {
		const post = offlinePost(
			rawPost as TPost & Readonly<Record<string, unknown>>,
			input.prepareCooked,
		);
		if (post) unique.set(post.post_number, post);
	}
	const posts = Object.freeze([...unique.values()]
		.sort((left, right) => left.post_number - right.post_number));
	if (!posts.length) throw new Error('离线 Topic 没有可导出的正文');
	const quotedPostRecords = new Map<string, Readonly<{
		readonly topicId: number;
		readonly post: ReaderOfflinePost;
	}>>();
	for (const entry of input.quotedPosts ?? []) {
		const quotedTopicId = Number(entry.topicId);
		const post = offlinePost(
			entry.post as TPost & Readonly<Record<string, unknown>>,
			input.prepareCooked,
		);
		if (
			!post || !Number.isSafeInteger(quotedTopicId) || quotedTopicId < 1 ||
			(quotedTopicId === topicId && unique.has(post.post_number))
		) continue;
		const key = `${quotedTopicId}:${post.post_number}`;
		quotedPostRecords.set(key, Object.freeze({
			topicId: quotedTopicId,
			post,
		}));
	}
	const quotedPosts = Object.freeze([...quotedPostRecords.values()].sort(
		(left, right) => left.topicId - right.topicId ||
			left.post.post_number - right.post.post_number,
	));
	const availablePostNumbers = new Set(posts.map((post) => post.post_number));
	const selectedProjection = input.projectionMode === 'op' ||
		input.projectionMode === 'custom';
	const mainPostNumbers = selectedProjection
		? Object.freeze([...new Set((input.mainPostNumbers ?? []).map(Number))]
			.filter((postNumber) =>
				Number.isSafeInteger(postNumber) && postNumber > 0)
			.sort((left, right) => left - right))
		: Object.freeze(posts.map((post) => post.post_number));
	if (selectedProjection && !mainPostNumbers.length) {
		throw new Error('离线 Topic 没有所选主流楼层');
	}
	const missingMainPostNumbers = mainPostNumbers.filter((postNumber) =>
		!availablePostNumbers.has(postNumber));
	if (missingMainPostNumbers.length) {
		throw new Error(
			`离线 Topic 缺少所选楼层：${missingMainPostNumbers.slice(0, 12).join(',')}`,
		);
	}
	const title = String(input.title || `Topic #${topicId}`).trim();
	const generatedAt = Math.max(0, Number(input.generatedAt ?? Date.now()) || 0);
	const expectedPostCount = Math.max(
		mainPostNumbers.length,
		Math.floor(Number(input.expectedPostCount) || 0),
	);
	const inlineReplyTreeMaxDepth = Math.min(
		5,
		Math.max(1, Math.trunc(Number(input.inlineReplyTreeMaxDepth) || 3)),
	);
	const archive = Object.freeze({
		topic: input.archive.topic
			? Object.freeze({
				...input.archive.topic,
				reason: localArchiveReason(input.archive.topic) ||
					localArchiveReason(input.topic),
			})
			: null,
		posts: Object.freeze(input.archive.posts.map((entry) => Object.freeze({
			...entry,
			reason: localArchiveReason(entry) ||
				localArchiveReason(unique.get(Number(entry.postNumber))),
		}))),
	});
	const header = input.header ?? Object.freeze({
		topicId,
		categoryId: 0,
		title,
		ownerUsername: String(posts[0]?.username ?? ''),
		ownerHref: '',
		statsText: `${posts.length} 帖`,
		category: null,
		tags: Object.freeze([]),
		vote: null,
	});
	const topicRecord = input.topic as Readonly<Record<string, unknown>>;
	const theme = input.presentation?.theme === 'dark' ? 'dark' : 'light';
	const translationMode = input.presentation?.translationMode === 'translation'
		? 'translation'
		: input.presentation?.translationMode === 'bilingual'
			? 'bilingual'
			: 'original';
	const translationTheme = normalizeReaderTranslationTheme(
		input.presentation?.translationTheme,
	);
	const readerStyle = offlineReaderStyle(input.presentation?.styleProperties);
	const reactionEmojiSources = offlineReactionEmojiSources(
		posts,
		input.sourceUrl,
		input.reactionEmojiUrl,
	);
	const inlineEmojiSources = offlineInlineEmojiSources(
		[title, header, archive, posts, quotedPosts],
		input.sourceUrl,
		input.inlineEmojiUrl,
	);
	const payload = Object.freeze({
		schemaVersion: 9,
		topicId,
		title,
		ownerUsername: String(header.ownerUsername || posts[0]?.username || ''),
		sourceUrl: String(input.sourceUrl),
		baseUrl: absoluteDocumentUrl('/', input.sourceUrl),
		generatedAt,
		inlineReplyTreeMaxDepth,
		projectionMode: selectedProjection ? input.projectionMode : 'all',
		mainPostNumbers: selectedProjection ? mainPostNumbers : null,
		expectedPostCount,
		complete: input.complete && mainPostNumbers.length >= expectedPostCount,
		postVoting: topicRecord.is_post_voting === true,
		theme,
		translationMode,
		translationTheme,
		reactionEmojiSources,
		inlineEmojiSources,
		solvedAnswerPostNumbers: solvedAnswerPostNumbers(
			topicRecord,
			posts,
			availablePostNumbers,
		),
		archive,
		posts,
		quotedPosts,
	});
	const stylesheet = `${String(input.stylesheet ?? '')}\n${OFFLINE_STYLES}`
		.replace(/<\/style/gi, '<\\/style');
	const archiveNotice = archive.topic
		? `<aside class="ldp-topic-local-archive-notice">${htmlText([
			`本地存档 · ${localArchiveStatusLabel(archive.topic.status)}`,
			archive.topic.reason ? `原因：${archive.topic.reason}` : '',
		].filter(Boolean).join(' · '))}；正文不代表服务器当前版本。</aside>`
		: '';
	const headerOwnerHref = absoluteDocumentUrl(header.ownerHref, input.sourceUrl);
	const ownerHtml = header.ownerUsername
		? '<span class="ldp-meta-owner"><span class="ldp-meta-owner-copy">楼主&nbsp;' +
			`<a class="ldp-user-link ldp-topic-owner-link ldp-meta-owner-value"${
				headerOwnerHref
					? ` href="${htmlText(headerOwnerHref)}" target="_blank" rel="noopener"`
					: ''
			}>@${htmlText(header.ownerUsername)}</a></span></span>`
		: '';
	const offlineIdentityIcon = (
		requested: string,
		fallback: 'code' | 'tag',
	): string => readerIconSvgMarkup(
		hasReaderIcon(requested) ? requested : fallback,
	);
	const identityHtml = [
		header.category
			? `<a class="ldp-topic-tag ldp-topic-category" href="${htmlText(
				absoluteDocumentUrl(header.category.href, input.sourceUrl) ||
					input.sourceUrl,
			)}" target="_blank" rel="noopener">${offlineIdentityIcon(
				header.category.icon,
				'code',
			)}<span class="ldp-topic-tag-text">${
				htmlText(header.category.level
					? `${header.category.name}, ${header.category.level}`
					: header.category.name)
			}</span></a>`
			: '',
		...header.tags.map((tag) =>
			`<a class="ldp-topic-tag ldp-topic-label" href="${htmlText(
				absoluteDocumentUrl(tag.href, input.sourceUrl) || input.sourceUrl,
			)}" target="_blank" rel="noopener">${offlineIdentityIcon(
				tag.icon,
				'tag',
			)}<span class="ldp-topic-tag-text">${
				htmlText(tag.name)
			}</span></a>`),
	].filter(Boolean).join('');
	const offlineSearchIcon = readerIconSvgMarkup('search');
	const offlineOnlyOpIcon = readerIconSvgMarkup('user-round');
	const offlineJumpIcon = readerIconSvgMarkup('arrow-up');
	const offlineClearIcon = readerIconSvgMarkup('x');
	const topicVoteHtml = header.vote
		? '<span class="ldp-topic-vote-slot ldp-offline-topic-vote-slot">' +
			`<span class="ldp-topic-vote ldp-offline-topic-vote${
				header.vote.voted ? ' on' : ''
			}">▲ <span>${Math.max(0, Number(header.vote.count) || 0)}</span> 票</span>` +
			'</span>'
		: '';
	const logoUrl = absoluteDocumentUrl(input.siteLogoUrl, input.sourceUrl);
	const logoHtml = logoUrl
		? `<img class="ldp-logo" src="${htmlText(logoUrl)}" alt="" loading="lazy" decoding="async">`
		: '<span class="ldp-offline-logo-fallback"></span>';
	const readerClassName = `ldp-overlay ldp-fullpage${
		input.presentation?.structureColorsDisabled
			? ' ldp-structure-colors-disabled'
			: ''
	}${translationMode === 'original' ? '' : ' ldp-translation-active'}${
		translationMode === 'translation' ? ' ldp-translation-only' : ''
	}`;
	const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer-when-downgrade">
<base href="${htmlText(absoluteDocumentUrl('/', input.sourceUrl))}">
<title>${htmlText(title)} · Lite 离线阅读</title>
<style>${stylesheet}</style>
</head>
<body>
<div class="${readerClassName}" data-offline-reader data-ldp-theme="${theme}" data-translation-theme="${translationTheme}"${
	readerStyle ? ` style="${htmlText(readerStyle)}"` : ''
}>
  <div class="ldp-modal">
    <header class="ldp-header ldp-title-single-line">
	  <span class="ldp-home-logo" aria-hidden="true">${logoHtml}</span>
      <div class="ldp-title-wrap">
        <h2 class="ldp-title"><span id="ldp-offline-title" class="ldp-title-jump">${htmlText(title)}</span></h2>
        <div class="ldp-title-subline">
		  <div class="ldp-meta-row"><div class="ldp-meta"><span class="ldp-meta-stats">${htmlText(
			header.statsText,
		)}</span>${ownerHtml}<span id="ldp-offline-status" class="ldp-offline-status"></span></div></div>
		  <div class="ldp-title-topic-row"><div class="ldp-title-topic-scroller"><div class="ldp-topic-tags"${
			identityHtml ? '' : ' hidden'
		  }>${identityHtml}</div>${topicVoteHtml}</div></div>
        </div>
      </div>
	  <section class="ldp-offline-tools" aria-label="离线正文工具">
	    <div class="ldp-offline-search-wrap">
	      <form id="ldp-offline-search-form" class="ldp-offline-search" role="search">
	        <span class="ldp-offline-tool-icon" aria-hidden="true">${offlineSearchIcon}</span>
	        <input id="ldp-offline-search-input" type="search" autocomplete="off" spellcheck="false" placeholder="搜索楼层 ID、用户名或正文" aria-label="搜索离线楼层 ID、用户名或正文" aria-controls="ldp-offline-search-results" aria-expanded="false">
	        <button id="ldp-offline-search-clear" class="ldp-offline-search-clear" type="button" aria-label="清除搜索" hidden>${offlineClearIcon}</button>
	      </form>
	      <div id="ldp-offline-search-results" class="ldp-offline-search-results" role="listbox" aria-label="离线搜索结果" hidden></div>
	    </div>
	    <button id="ldp-offline-only-op" class="ldp-offline-only-op" type="button" aria-pressed="false">${offlineOnlyOpIcon}<span>只看楼主</span></button>
	    <form id="ldp-offline-jump-form" class="ldp-offline-jump-form">
	      <label class="ldp-offline-jump-field"><span aria-hidden="true">#</span><input id="ldp-offline-jump-input" type="text" inputmode="numeric" autocomplete="off" placeholder="楼层号" aria-label="输入要跳转的楼层号"></label>
	      <button type="submit">${offlineJumpIcon}<span>跳转</span></button>
	    </form>
	    <p id="ldp-offline-tool-status" class="ldp-offline-tool-status" role="status" aria-live="polite"></p>
	  </section>
	    </header>
	    <div class="ldp-reader-main">
	      <main id="ldp-offline-viewport" class="ldp-body">
	        <section class="ldp-topic-runtime${archive.topic ? ' is-local-archive-topic' : ''}" data-topic-id="${topicId}">
          ${archiveNotice}
          <div class="ldp-virtual-stream">
            <div id="ldp-offline-before" class="ldp-virtual-spacer ldp-virtual-spacer-before" aria-hidden="true"></div>
            <div id="ldp-offline-posts" class="ldp-virtual-root-list ldp-segmented-branches"></div>
            <div id="ldp-offline-after" class="ldp-virtual-spacer ldp-virtual-spacer-after" aria-hidden="true"></div>
          </div>
        </section>
      </main>
    </div>
  </div>
</div>
<script id="ldp-offline-topic-data" type="application/json">${serializedJson(payload)}</script>
${OFFLINE_RUNTIME_SCRIPT_OPEN}(${readerTopicOfflineRuntime.toString()})();<\/script>
</body>
</html>`;
	return Object.freeze({
		html,
		filename: `${safeFilename(title)}-${topicId}-lite-offline.html`,
		postCount: mainPostNumbers.length,
		expectedPostCount,
		complete: payload.complete,
	});
}
