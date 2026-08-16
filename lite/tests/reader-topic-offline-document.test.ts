import { parseHTML } from 'linkedom';
import {
	createReaderTopicOfflineDocument,
	hydrateReaderTopicOfflineDocumentWindow,
	prepareReaderTopicOfflineBlobHtml,
	prioritizeReaderTopicOfflineTargetCandidates,
	readerTopicOfflineQuoteTargets,
} from '../src/archive/reader-topic-offline-document.js';
import {
	prepareReaderCookedCallouts,
} from '../src/media/reader-cooked-content-feature.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestPost {
	readonly id: number;
	readonly post_number: number;
	readonly reply_to_post_number: number | null;
	readonly username: string;
	readonly name: string;
	readonly avatar_template: string;
	readonly created_at: string;
	readonly cooked: string;
	readonly deleted_reason?: string;
	readonly polls?: readonly unknown[];
	readonly event?: Readonly<Record<string, unknown>>;
	readonly boosts?: readonly unknown[];
	readonly reactions?: readonly unknown[];
	readonly actions_summary?: readonly unknown[];
	readonly post_voting_vote_count?: number;
	readonly post_voting_comments?: readonly unknown[];
	readonly accepted_answer?: boolean;
	readonly link_counts?: readonly Readonly<{
		readonly url: string;
		readonly clicks: number;
	}>[];
}

interface TestTopic {
	readonly id: number;
	readonly slug: string;
	readonly posts_count: number;
	readonly hidden_reason?: string;
	readonly is_post_voting?: boolean;
	readonly accepted_answer?: Readonly<{ readonly post_number: number }>;
	readonly post_stream: {
		readonly stream: readonly number[];
		readonly posts: readonly TestPost[];
	};
}

interface RuntimeHarness {
	readonly document: Document;
	readonly window: Window & { readonly Event: typeof Event };
	readonly viewport: HTMLElement;
	flushFrames(): void;
	flushIdle(count?: number): void;
}

function mountOfflineRuntime(
	html: string,
	options: Readonly<{
		height?: number;
		width?: number;
		parentHydration?: boolean;
	}> = {},
): RuntimeHarness {
	const parsed = parseHTML(html);
	const document = parsed.document as unknown as Document;
	const window = parsed.window as unknown as Window & {
		readonly Event: typeof Event;
	};
	const viewport = document.querySelector<HTMLElement>('#ldp-offline-viewport')!;
	const height = options.height ?? 800;
	const width = options.width ?? 1_200;
	Object.defineProperty(viewport, 'clientHeight', {
		configurable: true,
		value: height,
	});
	Object.defineProperty(viewport, 'scrollTop', {
		configurable: true,
		writable: true,
		value: 0,
	});
	Object.defineProperty(window, 'innerHeight', {
		configurable: true,
		value: height,
	});
	Object.defineProperty(window, 'innerWidth', {
		configurable: true,
		value: width,
	});
	let sequence = 0;
	const frames = new Map<number, FrameRequestCallback>();
	const idle = new Map<number, (deadline: {
		readonly didTimeout: boolean;
		timeRemaining(): number;
	}) => void>();
	const requestAnimationFrame = (callback: FrameRequestCallback): number => {
		const handle = ++sequence;
		frames.set(handle, callback);
		return handle;
	};
	const cancelAnimationFrame = (handle: number): void => {
		frames.delete(handle);
	};
	Object.defineProperty(window, 'requestAnimationFrame', {
		configurable: true,
		value: requestAnimationFrame,
	});
	Object.defineProperty(window, 'cancelAnimationFrame', {
		configurable: true,
		value: cancelAnimationFrame,
	});
	Object.defineProperty(window, 'location', {
		configurable: true,
		value: new URL('https://linux.do/t/offline-topic/10'),
	});
	Object.defineProperty(window, 'requestIdleCallback', {
		configurable: true,
		value: (callback: (deadline: {
			readonly didTimeout: boolean;
			timeRemaining(): number;
		}) => void): number => {
			const handle = ++sequence;
			idle.set(handle, callback);
			return handle;
		},
	});
	Object.defineProperty(window, 'cancelIdleCallback', {
		configurable: true,
		value: (handle: number): void => {
			idle.delete(handle);
		},
	});
	if (options.parentHydration) {
		hydrateReaderTopicOfflineDocumentWindow(window);
	} else {
		const runtimeSource = [...document.querySelectorAll<HTMLScriptElement>('script')]
			.at(-1)?.textContent ?? '';
		assert(runtimeSource, '离线 HTML 必须内联可执行阅读运行时');
		const executeRuntime = Function(
			'globalThis',
			runtimeSource,
		) as (environment: Readonly<Record<string, unknown>>) => void;
		executeRuntime({
			document,
			window,
			location: new URL(
				'https://linux.do/t/offline-topic/10',
			) as unknown as Location,
			URL,
			requestAnimationFrame,
			cancelAnimationFrame,
		});
	}
	return {
		document,
		window,
		viewport,
		flushFrames(): void {
			let passes = 0;
			while (frames.size && passes < 20) {
				passes += 1;
				const current = [...frames.values()];
				frames.clear();
				for (const callback of current) callback(performance.now());
			}
			assert(passes < 20, '离线运行时帧队列不得形成反馈循环');
		},
		flushIdle(count = 1): void {
			for (let index = 0; index < count; index += 1) {
				const next = idle.entries().next().value as
					| [number, (deadline: {
						readonly didTimeout: boolean;
						timeRemaining(): number;
					}) => void]
					| undefined;
				if (!next) return;
				idle.delete(next[0]);
				next[1]({ didTimeout: false, timeRemaining: () => 12 });
			}
		},
	};
}

const dangerousCooked =
	'<p>正文 &amp; 特殊类型 :penguin:</p></script><script id="escaped-script">bad()</script>' +
		'<p><span class="hashtag-cooked"><a href="/tag/game"><span class="hashtag-icon-placeholder"></span>game</a></span></p>' +
		'<p><a class="mention" href="/u/alice">@alice</a></p>' +
	'<p><a class="inline-onebox" href="/docs"><svg></svg>文档链接</a></p>' +
	'<aside class="onebox allowlistedgeneric" data-onebox-src="https://grasp-rat-game.h-e.top">' +
	'<header class="source"><img class="site-icon" src="/favicon.png">' +
	'<a href="https://grasp-rat-game.h-e.top">grasp-rat-game.h-e.top</a></header>' +
	'<article class="onebox-body"><img class="thumbnail" src="/preview.png">' +
	'<h3><a href="https://grasp-rat-game.h-e.top">团团鼠历险记</a></h3></article></aside>' +
	'<img src="/optimized.png" data-orig-src="/original.png">' +
	'<img class="emoji emoji-custom" src="images/emoji/twitter/sparkling_heart.png">' +
	'<aside class="quote" data-topic="10" data-post="2">' +
	'<div class="title"><a href="/t/offline-topic/10/2">member</a></div>' +
	'<blockquote><p>第二楼引用摘录</p>' +
	'<a href="/uploads/default/original/quote.png">[image]</a>' +
	'</blockquote></aside>' +
	'<aside class="quote" data-topic="20" data-post="7">' +
	'<div class="title"><a href="/t/external-topic/20/7">external</a></div>' +
	'<blockquote><p>跨 Topic 引用摘录</p>' +
	'<a href="/uploads/default/original/external-quote-excerpt.png">[image]</a>' +
	'</blockquote></aside>' +
	'<pre><code>const answer = ":penguin:";</code></pre>' +
	'<table><tr><td>cell</td></tr></table>';
const posts: readonly TestPost[] = Object.freeze([
	Object.freeze({
		id: 101,
		post_number: 1,
		reply_to_post_number: null,
		username: 'op',
		name: 'Owner',
		avatar_template: '/user_avatar/linux.do/op/{size}/1.png',
		created_at: '2026-08-09T00:00:00.000Z',
		cooked: dangerousCooked,
		boosts: Object.freeze([Object.freeze({
			id: 91,
			user: Object.freeze({
				id: 9,
				username: 'booster',
				name: 'Boost User',
				avatar_template: '/user_avatar/linux.do/booster/{size}/1.png',
			}),
			cooked: '<p>这条 Boost 也属于正文快照</p>',
		})]),
		reactions: Object.freeze([
			Object.freeze({ id: 'heart', count: 3 }),
			Object.freeze({ id: 'clap', count: 2 }),
			Object.freeze({ id: 'distorted_face', count: 14 }),
		]),
		link_counts: Object.freeze([
			Object.freeze({ url: '/docs', clicks: 1_234 }),
			Object.freeze({ url: 'https://grasp-rat-game.h-e.top', clicks: 5_628 }),
		]),
	}),
	Object.freeze({
		id: 102,
		post_number: 2,
		reply_to_post_number: 1,
		username: 'member',
		name: 'Member',
		avatar_template: '/user_avatar/linux.do/member/{size}/1.png',
		created_at: '2026-08-09T00:01:00.000Z',
		hidden: true,
		cooked: '<h2><strong>第二楼正文</strong>完整内容</h2>' +
			'<img src="/uploads/default/original/second-full.png" alt="第二楼完整图">' +
			'<div class="poll" data-poll-name="poll"></div>',
		deleted_reason: '楼层由作者删除',
		reactions: Object.freeze([
			Object.freeze({ id: 'heart', count: 1 }),
		]),
		polls: Object.freeze([Object.freeze({
			name: 'poll',
			title: '离线投票',
			voters: 3,
			options: Object.freeze([
				Object.freeze({ id: 'a', html: '选项 A', votes: 2 }),
				Object.freeze({ id: 'b', html: '选项 B', votes: 1 }),
			]),
		})]),
		post_voting_vote_count: 7,
		post_voting_comments: Object.freeze([Object.freeze({
			username: 'voter',
			name: 'Voting User',
			avatar_template: '/user_avatar/linux.do/voter/{size}/1.png',
			cooked: '<p>离线投票评论</p>',
			post_voting_vote_count: 2,
		})]),
	}),
	Object.freeze({
		id: 103,
		post_number: 3,
		reply_to_post_number: 2,
		username: 'nested',
		name: 'Nested Member',
		avatar_template: '/user_avatar/linux.do/nested/{size}/1.png',
		created_at: '2026-08-09T00:02:00.000Z',
		cooked: '<p>第三楼树状正文</p>',
		accepted_answer: true,
		event: Object.freeze({
			name: '离线活动',
			starts_at: '2026-08-10T08:00:00.000Z',
			ends_at: '2026-08-10T09:00:00.000Z',
			timezone: 'Asia/Shanghai',
			location: '线上',
			description_html: '<p>活动说明</p>',
			stats: Object.freeze({ going: 2, interested: 4 }),
		}),
	}),
]);
const externalQuotedPost: TestPost = Object.freeze({
	id: 207,
	post_number: 7,
	reply_to_post_number: null,
	username: 'external',
	name: 'External Member',
	avatar_template: '/user_avatar/linux.do/external/{size}/1.png',
	created_at: '2026-08-09T00:07:00.000Z',
	cooked: '<h3><em>跨 Topic 完整引用正文</em></h3>' +
		'<img src="/uploads/default/original/external-quote-full.png" alt="外部引用图">',
});
const topic: TestTopic = {
	id: 10,
	slug: 'offline-topic',
	posts_count: 4,
	is_post_voting: true,
	accepted_answer: Object.freeze({ post_number: 3 }),
	hidden_reason: '主题由作者删除',
	post_stream: { stream: [101, 102, 103], posts },
};
const result = createReaderTopicOfflineDocument({
	topicId: 10,
	title: '离线 / Topic: 测试 :penguin:',
	sourceUrl: 'https://linux.do/t/offline-topic/10',
	topic,
	posts,
	quotedPosts: Object.freeze([Object.freeze({
		topicId: 20,
		post: externalQuotedPost,
	})]),
	expectedPostCount: 4,
	complete: false,
	archive: Object.freeze({
		topic: Object.freeze({ status: 404, confirmedAt: 1_000 }),
		posts: Object.freeze([
			Object.freeze({ postNumber: 2, status: 410, confirmedAt: 1_001 }),
		]),
	}),
	inlineReplyTreeMaxDepth: 3,
	header: Object.freeze({
		topicId: 10,
		categoryId: 7,
		title: '离线 / Topic: 测试',
		ownerUsername: 'op',
		ownerHref: '/u/op',
		statsText: '4 帖 · 128 浏览 · 3 赞 · 2 用户',
		category: Object.freeze({
			id: 7,
			name: '开发调优',
			level: 'Lv1',
			icon: 'code',
			href: '/c/develop/7',
		}),
		tags: Object.freeze([
			Object.freeze({ name: '纯水', icon: 'tag', href: '/tag/纯水' }),
		]),
		vote: Object.freeze({ count: 12, voted: true, canVote: true }),
	}),
	siteLogoUrl: '/images/logo.png',
	reactionEmojiUrl: (reactionId) =>
		`/images/emoji/twitter/${encodeURIComponent(reactionId)}.png`,
	inlineEmojiUrl: (emojiId) =>
		`/images/emoji/twitter/${encodeURIComponent(emojiId)}.png`,
	presentation: Object.freeze({
		theme: 'dark',
		translationMode: 'bilingual',
		translationTheme: 'highlight',
		styleProperties: Object.freeze({
			'--ldp-post-font-size': '17px',
			'--ldp-reply-line-width': '2px',
			'--ldp-reader-window-left': '999px',
		}),
		structureColorsDisabled: true,
	}),
	stylesheet: '.reader-runtime-style { color: red; }',
	generatedAt: 2_000,
});

assert(
	result.filename === '离线 _ Topic_ 测试 _penguin_-10-lite-offline.html' &&
		result.postCount === 3 &&
		result.expectedPostCount === 4 &&
		!result.complete,
	'离线导出必须返回稳定安全文件名和明确的正文覆盖度',
);
const offlineDocumentContract = Object.freeze({
	scriptCount: (result.html.match(/<script\b/g) ?? []).length,
	escapedCookedScript:
		!result.html.includes('</script><script id="escaped-script">'),
	hasOriginalImageData: result.html.includes('data-orig-src'),
	hasOriginalImageRuntime: result.html.includes('.dataset.origSrc'),
	disablesOptimizedImageCandidates:
		result.html.includes('removeAttribute') && result.html.includes('srcset'),
	hasCanonicalReaderShell:
		result.html.includes('ldp-overlay ldp-fullpage') &&
		result.html.includes('class="ldp-modal"') &&
		result.html.includes('class="ldp-header') &&
		result.html.includes('class="ldp-reader-main"') &&
		result.html.includes('class="ldp-body"') &&
		result.html.includes('class="ldp-topic-runtime'),
	hasCenteredFullscreenReadingLayout:
		result.html.includes('--ldp-offline-content-width: min(1440px, 76vw)') &&
		result.html.includes('--ldp-offline-page-gutter') &&
		result.html.includes('minmax(0, var(--ldp-offline-content-width))'),
	hasIdentitySvgIcons:
		result.html.includes(
			'class="ldp-topic-tag ldp-topic-category"',
		) && result.html.includes('data-icon="code"') &&
		result.html.includes('class="ldp-topic-tag ldp-topic-label"') &&
		result.html.includes('data-icon="tag"'),
	hasVirtualTreeRuntime:
		result.html.includes('ldp-virtual-root-list ldp-segmented-branches') &&
		result.html.includes('ldp-post-projection-pending') &&
		result.html.includes('ldp-virtual-ancestor-shell') &&
		result.html.includes('requestIdleCallback'),
	hasOfflineBranchReading:
		result.html.includes('ldp-offline-branch-toggle') &&
		result.html.includes('ldp-offline-discussion-layer') &&
		result.html.includes('ldp-offline-branch-symbol') &&
		result.html.includes('prepareOfflineCooked'),
	hasOfflineSearchAndJump:
		result.html.includes('id="ldp-offline-search-input"') &&
		result.html.includes('id="ldp-offline-search-results"') &&
		result.html.includes('id="ldp-offline-only-op"') &&
		result.html.includes('id="ldp-offline-jump-input"') &&
		result.html.includes('data-offline-search-post') &&
		result.html.includes('jumpToOfflinePost'),
	hasUnifiedOfflineToolStrip:
		result.html.includes('minmax(420px, 560px)') &&
		/\.ldp-offline-tools\s*\{[^}]*grid-column:\s*3;[^}]*grid-row:\s*1 \/ 4;/s
			.test(result.html) &&
		!result.html.includes('@media (max-width: 1500px)') &&
		/@media \(max-width:\s*700px\)\s*\{[\s\S]*?\.ldp-header\s*\{[^}]*grid-template-columns:\s*var\(--ldp-home-logo-box-size\) minmax\(0, 1fr\);[^}]*grid-template-rows:\s*auto auto auto auto;[\s\S]*?\.ldp-offline-tools\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*grid-row:\s*4;/s
			.test(result.html) &&
		/\.ldp-offline-tools\s*\{[^}]*border:\s*1px[^}]*border-radius:\s*8px/s
			.test(result.html) &&
		/\.ldp-offline-search,\s*\n[^\n]*\.ldp-offline-jump-field\s*\{[^}]*border:\s*0;/s
			.test(result.html) &&
		result.html.includes(
			'font-size: var(--ldp-reader-title-font-size, var(--ldp-font-xl, 16px))',
		) &&
		result.html.includes('height: 28px') &&
		result.html.includes('.ldp-offline-only-op::before'),
	hasReplyLineAnchoredBranchControls:
		result.html.includes(
			'.ldp-offline-branch-first-child-anchor[aria-expanded="true"]',
		) &&
		result.html.includes(
			'left: calc(var(--ldp-thread-avatar-size) / -2)',
		) && result.html.includes('--ldp-offline-branch-anchor-offset'),
	hasCenteredContextDiscussion:
		/\.ldp-offline-context-discussion\s*\{[^}]*display:\s*flex;[^}]*margin:\s*6px auto 8px;/s
			.test(result.html),
	hasContinuousDiscussionRails:
		/\.ldp-offline-discussion-list\.ldp-segmented-branches\s+\.ldp-offline-discussion-post\s*\{[^}]*content-visibility:\s*visible;/s
			.test(result.html),
	hasDirectImageZoom:
		/\.ldp-offline-image-frame\s*\{[^}]*width:\s*100%/s.test(result.html) &&
		/\.ldp-offline-image-frame\s*>\s*:is\(a,picture,img\)\s*\{[^}]*width:\s*var\(--ldp-offline-image-scale\)/s
			.test(result.html) &&
		result.html.includes('cyclePresetScale') &&
		!result.html.includes('ldp-offline-image-toolbar'),
	hasReaderStyles: result.html.includes('.reader-runtime-style'),
});
assert(
	Object.values(offlineDocumentContract).every(Boolean),
	`单 HTML 必须安全内联数据、Reader 原样骨架、样式及虚拟树水合运行时：${
		JSON.stringify(offlineDocumentContract)
	}`,
);

const parsed = parseHTML(result.html);
const parsedDocument = parsed.document as unknown as Document;
const nonceSource = parseHTML(
	'<!doctype html><html><head><script nonce="offline-view-nonce"></script></head></html>',
).document as unknown as Document;
const noncePreparedHtml = prepareReaderTopicOfflineBlobHtml(
	result.html,
	nonceSource,
);
assert(
	noncePreparedHtml.includes(
		'<script id="ldp-offline-topic-runtime" nonce="offline-view-nonce">',
	) &&
		prepareReaderTopicOfflineBlobHtml(result.html, parsedDocument) === result.html,
	'Blob 离线 HTML 必须只在查看副本中注入宿主 CSP nonce，并保留无 nonce 存档原文',
);
const dataNode = parsedDocument.querySelector<HTMLScriptElement>(
	'#ldp-offline-topic-data',
)!;
const payload = JSON.parse(dataNode.textContent ?? '{}') as {
	readonly schemaVersion?: number;
	readonly ownerUsername?: string;
	readonly reactionEmojiSources?: Readonly<Record<string, string>>;
	readonly inlineEmojiSources?: Readonly<Record<string, string>>;
	readonly translationMode?: string;
	readonly translationTheme?: string;
	readonly solvedAnswerPostNumbers?: readonly number[];
	readonly quotedPosts?: readonly {
		readonly topicId?: number;
		readonly post?: { readonly post_number?: number; readonly cooked?: string };
	}[];
	readonly posts?: readonly {
		readonly cooked?: string;
		readonly polls?: readonly unknown[];
		readonly offline_estimated_size?: number;
		readonly offline_search_text?: string;
	}[];
	readonly archive?: {
		readonly topic?: { readonly status?: number; readonly reason?: string };
		readonly posts?: readonly { readonly reason?: string }[];
	};
};
assert(
	payload.schemaVersion === 9 &&
		payload.ownerUsername === 'op' &&
		payload.reactionEmojiSources?.distorted_face ===
			'https://linux.do/images/emoji/twitter/distorted_face.png' &&
		payload.inlineEmojiSources?.penguin ===
			'https://linux.do/images/emoji/twitter/penguin.png' &&
	payload.translationMode === 'bilingual' &&
	payload.translationTheme === 'highlight' &&
	parsedDocument.querySelector<HTMLElement>('[data-offline-reader]')
		?.dataset.translationTheme === 'highlight' &&
		parsedDocument.querySelector<HTMLBaseElement>('base')?.getAttribute('href') ===
			'https://linux.do/' &&
		payload.solvedAnswerPostNumbers?.join(',') === '3' &&
		payload.quotedPosts?.[0]?.topicId === 20 &&
		payload.quotedPosts?.[0]?.post?.post_number === 7 &&
		payload.quotedPosts?.[0]?.post?.cooked === externalQuotedPost.cooked &&
		payload.posts?.[0]?.cooked === dangerousCooked &&
		Number(payload.posts?.[0]?.offline_estimated_size) > 0 &&
		/第二楼正文\s*完整内容/.test(
			payload.posts?.[1]?.offline_search_text ?? '',
		) &&
		!payload.posts?.[1]?.offline_search_text?.includes('<h2>') &&
		payload.posts?.[1]?.polls?.length === 1 &&
		payload.archive?.topic?.status === 404 &&
		payload.archive?.topic?.reason === '主题由作者删除' &&
		payload.archive?.posts?.[0]?.reason === '楼层由作者删除' &&
		parsedDocument.querySelector('.ldp-topic-local-archive-notice')?.textContent
			.includes('主题由作者删除') === true &&
		parsedDocument.querySelector('.ldp-meta-stats')?.textContent
			.includes('128 浏览') === true &&
		parsedDocument.querySelector('.ldp-meta-owner-value')?.textContent === '@op' &&
		parsedDocument.querySelector('.ldp-topic-category')?.textContent
			.includes('开发调优') === true &&
		parsedDocument.querySelector('.ldp-topic-label')?.textContent === '纯水' &&
		parsedDocument.querySelector('.ldp-offline-topic-vote')?.textContent
			?.includes('12') === true &&
		parsedDocument.querySelector<HTMLImageElement>('.ldp-home-logo .ldp-logo')
			?.src === 'https://linux.do/images/logo.png' &&
		parsedDocument.querySelector<HTMLElement>('[data-offline-reader]')
			?.dataset.ldpTheme === 'dark' &&
		parsedDocument.querySelector<HTMLElement>('[data-offline-reader]')
			?.classList.contains('ldp-structure-colors-disabled') === true &&
		parsedDocument.querySelector<HTMLElement>('[data-offline-reader]')
			?.classList.contains('ldp-translation-active') === true &&
		parsedDocument.querySelector<HTMLElement>('[data-offline-reader]')
			?.classList.contains('ldp-translation-only') === false &&
		parsedDocument.querySelector<HTMLElement>('[data-offline-reader]')
			?.style.getPropertyValue('--ldp-post-font-size') === '17px' &&
		parsedDocument.querySelector<HTMLElement>('[data-offline-reader]')
			?.style.getPropertyValue('--ldp-reader-window-left') === '' &&
		!result.html.includes('此 HTML 仅包含下载时仍可取得的本地正文') &&
		parsedDocument.querySelector('[data-offline-reader] .ldp-modal') !== null &&
		parsedDocument.querySelector('.ldp-header > .ldp-offline-tools') !== null &&
		parsedDocument.querySelector('#ldp-offline-viewport > .ldp-offline-tools') ===
			null &&
		parsedDocument.querySelector('#ldp-offline-search') === null &&
		parsedDocument.querySelector('#ldp-offline-theme') === null,
	'打开 HTML 前必须已具备内联正文、失效状态与纯阅读 Reader 外壳',
);
assert(
	readerTopicOfflineQuoteTargets(parsedDocument, 10, posts)
		.map((target) => `${target.topicId}:${target.postNumber}`).join(',') ===
			'10:2,20:7',
	'下载准备阶段必须提取同 Topic 与跨 Topic 的唯一引用目标',
);
const originalCandidates = Object.freeze([
	Object.freeze({ endpoint: 'post-by-number', url: '/first' }),
	Object.freeze({ endpoint: 'topic-floor', url: '/second' }),
	Object.freeze({ endpoint: 'topic-id-query', url: '/third' }),
]);
const preferredCandidates = prioritizeReaderTopicOfflineTargetCandidates(
	originalCandidates,
	'topic-id-query',
);
assert(
	preferredCandidates.map((candidate) => candidate.endpoint).join(',') ===
		'topic-id-query,post-by-number,topic-floor' &&
	originalCandidates.map((candidate) => candidate.endpoint).join(',') ===
		'post-by-number,topic-floor,topic-id-query',
	'跨 Topic 引用必须优先复用同 Topic 已命中的 endpoint，同时保留原始 fallback 且不改写目录',
);

const richDocument = parseHTML('<!doctype html><html><body></body></html>')
	.document as unknown as Document;
const prepareCooked = (cooked: string): string => {
	const host = richDocument.createElement('div');
	host.innerHTML = cooked;
	prepareReaderCookedCallouts(richDocument, host);
	return host.innerHTML;
};
const richResult = createReaderTopicOfflineDocument({
	topicId: 30,
	title: '富正文离线测试',
	sourceUrl: 'https://linux.do/t/rich-offline/30',
	topic: Object.freeze({
		...topic,
		id: 30,
		slug: 'rich-offline',
		posts_count: 1,
		post_stream: Object.freeze({ stream: Object.freeze([301]), posts: Object.freeze([]) }),
	}),
	posts: Object.freeze([Object.freeze({
		...posts[0],
		id: 301,
		cooked: '<blockquote><p>[!danger]- 风险<br>正文</p></blockquote>',
		boosts: Object.freeze([Object.freeze({
			cooked: '<blockquote><p>[!tip] Boost 正文</p></blockquote>',
		})]),
		post_voting_comments: Object.freeze([Object.freeze({
			id: 1,
			cooked: '<blockquote><p>[!note] 评论正文</p></blockquote>',
		})]),
	})]),
	expectedPostCount: 1,
	complete: true,
	archive: Object.freeze({ topic: null, posts: Object.freeze([]) }),
	stylesheet: '',
	prepareCooked,
});
const richPayload = JSON.parse(
	parseHTML(richResult.html).document.querySelector(
		'#ldp-offline-topic-data',
	)?.textContent ?? '{}',
) as Readonly<{ readonly posts?: readonly Readonly<Record<string, unknown>>[] }>;
const richPost = richPayload.posts?.[0] ?? {};
const richBoost = Array.isArray(richPost.boosts) ? richPost.boosts[0] : null;
const richComment = Array.isArray(richPost.post_voting_comments)
	? richPost.post_voting_comments[0]
	: null;
assert(
	String(richPost.cooked).includes('ldp-callout--danger') &&
		String((richBoost as Readonly<Record<string, unknown>> | null)?.cooked)
			.includes('ldp-callout--tip') &&
		String((richComment as Readonly<Record<string, unknown>> | null)?.cooked)
			.includes('ldp-callout--note'),
	'离线正文增强必须覆盖主正文、Boost 与投票评论，保持在线 Reader 同一 Callout DOM',
);
const richMounted = mountOfflineRuntime(richResult.html);
richMounted.flushFrames();
const richCalloutBody = richMounted.document.querySelector<HTMLElement>(
	'#post_1 .ldp-callout-body',
)!;
const richCalloutToggle = richMounted.document.querySelector<HTMLButtonElement>(
	'#post_1 [data-reader-callout-action="toggle"]',
)!;
assert(
	richCalloutBody.hidden && richCalloutToggle.getAttribute('aria-expanded') === 'false',
	'离线折叠 Callout 必须保留下载时的初始收纳状态',
);
richCalloutToggle.click();
richMounted.flushFrames();
assert(
	!richCalloutBody.hidden && richCalloutToggle.getAttribute('aria-expanded') === 'true',
	'离线 Callout 必须可在纯阅读 HTML 内独立展开',
);

const cspFallbackMounted = mountOfflineRuntime(result.html, {
	parentHydration: true,
});
cspFallbackMounted.flushFrames();
assert(
	cspFallbackMounted.document.querySelector<HTMLElement>(
		'[data-offline-reader]',
	)?.dataset.offlineHydrated === '1' &&
		cspFallbackMounted.document.querySelector('#post_1 .ldp-content')
			?.textContent?.includes('正文') === true,
	'Blob 页内联脚本被 CSP 阻止时，Reader 父页面必须仍能向新标签水合正文 DOM',
);

const mounted = mountOfflineRuntime(result.html);
mounted.flushFrames();
const root = mounted.document.querySelector<HTMLElement>('#post_1')!;
const child = mounted.document.querySelector<HTMLElement>('#post_2')!;
const grandchild = mounted.document.querySelector<HTMLElement>('#post_3')!;
assert(
	root && child && grandchild,
	`小主题首屏必须同步挂载完整可见树：${[
		...mounted.document.querySelectorAll<HTMLElement>('#ldp-offline-posts .ldp-post'),
	].map((post) => post.dataset.postNumber).join(',')}`,
);
const offlineInlineOnebox = root.querySelector<HTMLAnchorElement>(
	'a.inline-onebox',
)!;
const offlineOnebox = root.querySelector<HTMLElement>('aside.onebox')!;
assert(
	offlineInlineOnebox.querySelector('.ldp-inline-onebox-label')
		?.textContent === '文档链接' &&
		offlineInlineOnebox.querySelector('.ldp-link-click-count')
			?.textContent === '1,234' &&
		offlineOnebox.querySelector('.onebox-body h3 .ldp-link-click-count')
			?.textContent === '5,628' &&
		!offlineOnebox.querySelector('header.source .ldp-link-click-count'),
	'离线正文必须与在线 Reader 一致地整理 Onebox 标签并把点击数投影到唯一正文链接',
);
assert(
	offlineOnebox.querySelector(':scope > header.source > img.site-icon') !== null &&
		offlineOnebox.querySelector(':scope > article.onebox-body > img.thumbnail') !== null &&
			!offlineOnebox.querySelector('.ldp-offline-image-frame') &&
			root.querySelector('.hashtag-cooked .ldp-hashtag-icon[data-icon="tag"]') &&
			root.querySelector<HTMLElement>('.mention.ldp-user-link')
				?.dataset.userCard === 'alice',
		'离线图片缩放不得接管 Onebox 自有图像，Hashtag 与 mention 也必须复用在线正文语义',
);
assert(
	root.parentElement?.id === 'ldp-offline-posts' &&
		child.parentElement?.classList.contains('ldp-reply-list') === true &&
		child.closest('#post_1') === root &&
		grandchild.parentElement?.classList.contains('ldp-reply-list') === true &&
		grandchild.closest('#post_2') === child &&
		child.dataset.parentPostNumber === '1' &&
		child.dataset.ldpNestDepth === '1' &&
		grandchild.dataset.parentPostNumber === '2' &&
		grandchild.dataset.ldpNestDepth === '2' &&
		child.classList.contains('ldp-nested-preview') &&
		root.classList.contains('ldp-has-child-branches'),
	'离线 Reader 必须把楼层挂进与在线版一致的递归 replyList，而不是扁平列表',
);
const offlineSearchInput = mounted.document.querySelector<HTMLInputElement>(
	'#ldp-offline-search-input',
)!;
const offlineSearchResults = mounted.document.querySelector<HTMLElement>(
	'#ldp-offline-search-results',
)!;
offlineSearchInput.value = '102';
offlineSearchInput.dispatchEvent(new mounted.window.Event('input'));
assert(
	offlineSearchResults.hidden === false &&
		offlineSearchResults.querySelector<HTMLButtonElement>(
			'[data-offline-search-post]',
		)?.dataset.offlineSearchPost === '2',
	'离线搜索必须支持按 Discourse post ID 精确找到对应楼层',
);
offlineSearchInput.value = '第三楼树状正文';
offlineSearchInput.dispatchEvent(new mounted.window.Event('input'));
const bodySearchResult = offlineSearchResults.querySelector<HTMLButtonElement>(
	'[data-offline-search-post="3"]',
)!;
assert(
	bodySearchResult?.querySelector('.ldp-offline-search-result-snippet')
		?.textContent?.includes('第三楼树状正文') === true,
	'离线搜索必须索引完整正文文本并返回安全文本摘要',
);
bodySearchResult.click();
mounted.flushFrames();
assert(
	mounted.document.querySelector('#post_3')
		?.classList.contains('ldp-offline-jump-highlight') === true &&
		offlineSearchResults.hidden,
	'点击离线搜索结果必须定位并高亮对应楼层',
);
const offlineJumpInput = mounted.document.querySelector<HTMLInputElement>(
	'#ldp-offline-jump-input',
)!;
offlineJumpInput.value = '#2';
mounted.document.querySelector<HTMLFormElement>('#ldp-offline-jump-form')!
	.dispatchEvent(new mounted.window.Event('submit', {
		bubbles: true,
		cancelable: true,
	}));
mounted.flushFrames();
assert(
	mounted.document.querySelector('#post_2')
		?.classList.contains('ldp-offline-jump-highlight') === true &&
		mounted.document.querySelector('#ldp-offline-tool-status')
			?.textContent === '已定位到楼层 #2',
	'离线楼层跳转必须接受 #n，并定位及高亮已下载楼层',
);
const offlineQuote = root.querySelector<HTMLElement>('.ldp-post-quote')!;
const offlineQuoteToggle = offlineQuote.querySelector<HTMLButtonElement>(
	'[data-offline-quote-toggle]',
)!;
const offlineQuoteJump = offlineQuote.querySelector<HTMLAnchorElement>(
	'[data-offline-quote-jump="2"]',
)!;
const offlineQuoteImage = offlineQuote.querySelector<HTMLImageElement>(
	':scope > blockquote img',
)!;
const offlineCollapsedHtml = offlineQuote.querySelector(
	':scope > blockquote',
)?.innerHTML;
assert(
	offlineQuote.querySelector(':scope > .ldp-quote-title') !== null &&
		offlineQuote.dataset.ldpQuoteExpanded === '0' &&
		offlineQuote.dataset.ldpQuoteHydrated === undefined &&
		!offlineQuote.classList.contains('ldp-quote-expanded') &&
		offlineQuoteToggle.getAttribute('aria-expanded') === 'false' &&
		offlineQuoteToggle.getAttribute('aria-label') === '展开完整引用' &&
		offlineQuoteToggle.querySelector('[data-icon="chevron-down"]') !== null &&
		offlineQuoteJump.querySelector('[data-icon="arrow-up"]') !== null &&
		offlineQuoteJump.getAttribute('href') ===
			'https://linux.do/t/offline-topic/10/2' &&
		offlineQuoteJump.target === '_blank' &&
		offlineQuoteImage.getAttribute('src') ===
			'https://linux.do/uploads/default/original/quote.png' &&
		offlineQuoteImage.alt === '引用图片' &&
		offlineQuote.querySelector(':scope > blockquote')?.textContent
			?.includes('第二楼引用摘录') === true &&
		!offlineQuote.querySelector(':scope > blockquote')?.textContent
			?.includes('第二楼正文完整内容') &&
		offlineQuote.querySelector(':scope > blockquote > h2') === null,
	'离线文字引用必须保留下载正文中的原始片段与片段图片，不能由目标楼层全文覆写，并保留真实跳转',
);
offlineQuoteToggle.click();
assert(
	offlineQuote.classList.contains('ldp-quote-expanded') &&
		offlineQuote.dataset.ldpQuoteHydrated === '1' &&
		offlineQuote.querySelector(':scope > blockquote')?.innerHTML !==
			offlineCollapsedHtml &&
		offlineQuote.querySelector(':scope > blockquote')?.textContent
			?.includes('第二楼正文完整内容') === true &&
		offlineQuote.querySelector(':scope > blockquote > h2 > strong')
			?.textContent === '第二楼正文' &&
		offlineQuote.querySelector<HTMLImageElement>(':scope > blockquote img')
			?.src === 'https://linux.do/uploads/default/original/second-full.png' &&
		offlineQuoteToggle.querySelector('[data-icon="chevron-up"]') !== null,
	'离线文字引用展开必须切换到归档内被引用楼层的完整正文与图片',
);
offlineQuoteToggle.click();
assert(
	!offlineQuote.classList.contains('ldp-quote-expanded') &&
		offlineQuote.dataset.ldpQuoteHydrated === undefined &&
		offlineQuote.querySelector(':scope > blockquote')?.innerHTML ===
			offlineCollapsedHtml &&
		offlineQuote.querySelector(':scope > blockquote')?.textContent
			?.includes('第二楼引用摘录') === true &&
		offlineQuote.querySelector<HTMLImageElement>(
			':scope > blockquote img',
		)?.getAttribute('src') ===
			'https://linux.do/uploads/default/original/quote.png',
	'离线文字引用收起必须恢复原始片段正文与片段图片',
);
const externalQuote = [...root.querySelectorAll<HTMLElement>('.ldp-post-quote')]
	.find((quote) => quote.dataset.topic === '20')!;
const externalQuoteToggle = externalQuote.querySelector<HTMLButtonElement>(
	'[data-offline-quote-toggle]',
)!;
const externalQuoteJump = externalQuote.querySelector<HTMLAnchorElement>(
	'[data-offline-quote-jump="7"]',
)!;
const externalCollapsedHtml = externalQuote.querySelector(
	':scope > blockquote',
)?.innerHTML;
assert(
	externalQuote.dataset.ldpQuoteExpanded === '0' &&
		externalQuote.dataset.ldpQuoteHydrated === undefined &&
		externalQuoteToggle.getAttribute('aria-expanded') === 'false' &&
		externalQuoteToggle.querySelector('[data-icon="chevron-down"]') !== null &&
		externalQuoteJump.href === 'https://linux.do/t/external-topic/20/7' &&
		externalQuote.querySelector(':scope > blockquote')?.textContent
			?.includes('跨 Topic 引用摘录') === true &&
		externalQuote.querySelector(':scope > blockquote > h3') === null &&
		externalQuote.querySelector<HTMLImageElement>(':scope > blockquote img')
			?.src === 'https://linux.do/uploads/default/original/external-quote-excerpt.png',
	'跨 Topic 文字引用也必须保留原始片段、片段图片与跳转目标，不能渲染外部楼层全文',
);
externalQuoteToggle.click();
assert(
	externalQuote.classList.contains('ldp-quote-expanded') &&
		externalQuote.dataset.ldpQuoteHydrated === '1' &&
		externalQuote.querySelector(':scope > blockquote')?.innerHTML !==
			externalCollapsedHtml &&
		externalQuote.querySelector(':scope > blockquote')?.textContent
			?.includes('跨 Topic 完整引用正文') === true &&
		externalQuote.querySelector<HTMLImageElement>(':scope > blockquote img')
			?.src === 'https://linux.do/uploads/default/original/external-quote-full.png' &&
		externalQuoteToggle.querySelector('[data-icon="chevron-up"]') !== null,
	'跨 Topic 文字引用展开必须切换到归档内附带的目标楼层完整正文',
);
externalQuoteToggle.click();
assert(
	!externalQuote.classList.contains('ldp-quote-expanded') &&
		externalQuote.dataset.ldpQuoteHydrated === undefined &&
		externalQuote.querySelector(':scope > blockquote')?.innerHTML ===
			externalCollapsedHtml &&
		externalQuote.querySelector(':scope > blockquote')?.textContent
			?.includes('跨 Topic 引用摘录') === true,
	'跨 Topic 文字引用收起必须恢复原始片段，不能残留目标楼层全文',
);
const rootBranchToggle = root.querySelector<HTMLButtonElement>(
	'[data-offline-branch-toggle="1"][data-offline-branch-scope="main"]',
)!;
const rootBranchDiscussion = root.querySelector<HTMLButtonElement>(
	'[data-offline-discussion-kind="branch"]',
)!;
assert(
	rootBranchToggle.dataset.offlineBranchState === 'expanded' &&
		rootBranchToggle.getAttribute('aria-expanded') === 'true' &&
		rootBranchToggle.querySelector(
			'.ldp-offline-branch-symbol[data-icon="minus"]',
		) !== null &&
		rootBranchToggle.parentElement === root.querySelector(
			':scope > .ldp-reply-tree',
		) &&
		rootBranchToggle.classList.contains(
			'ldp-offline-branch-first-child-anchor',
		) &&
		[...root.querySelectorAll<HTMLButtonElement>(
			'.ldp-offline-branch-toggle',
		)].filter((toggle) => !toggle.hidden).length === 2 &&
		child.querySelector<HTMLButtonElement>(
			'[data-offline-branch-toggle="2"]',
		)?.parentElement === child.querySelector(':scope > .ldp-reply-tree') &&
		rootBranchDiscussion.textContent === '查看完整分支' &&
		rootBranchDiscussion.querySelector('[data-icon="layers"]') !== null &&
		rootBranchDiscussion.dataset.offlineBranchDiscussion === '1' &&
		rootBranchDiscussion.hidden,
	'每个有直属子楼的父分支只能保留一个减号，并各自锚在首个子头像上方 10px',
);
rootBranchToggle.click();
mounted.flushFrames();
const collapsedRoot = mounted.document.querySelector<HTMLElement>('#post_1')!;
assert(
	collapsedRoot.classList.contains('ldp-branch-parent-collapsed') &&
		collapsedRoot.querySelector<HTMLButtonElement>(
			'.ldp-offline-branch-toggle',
		)?.dataset.offlineBranchState === 'collapsed' &&
		collapsedRoot.querySelector(
			'.ldp-offline-branch-symbol[data-icon="plus"]',
		) !== null &&
		collapsedRoot.querySelector<HTMLButtonElement>(
			'[data-offline-discussion-kind="branch"]',
		)?.hidden === false &&
		mounted.document.querySelector('#post_2') === null,
	'点击减号必须收起整条子树，并在加号旁提供该分支的完整查看入口',
);
collapsedRoot.querySelector<HTMLButtonElement>(
	'[data-offline-discussion-kind="branch"]',
)!.click();
const discussionLayer = mounted.document.querySelector<HTMLElement>(
	'.ldp-offline-discussion-layer',
)!;
assert(
	!discussionLayer.hidden &&
		discussionLayer.dataset.offlineBranchRoot === '1' &&
		discussionLayer.querySelector('.ldp-offline-discussion-title')
			?.textContent?.includes('查看完整分支（3）') === true &&
		discussionLayer.querySelectorAll('.ldp-offline-discussion-post').length === 3 &&
		[...discussionLayer.querySelectorAll<HTMLButtonElement>(
			'[data-offline-branch-scope="discussion"]',
		)].filter((toggle) => !toggle.hidden).length === 2 &&
		discussionLayer.querySelector<HTMLButtonElement>(
			'[data-offline-branch-toggle="1"]',
		)?.parentElement?.closest('.ldp-post')?.getAttribute('data-post-number') ===
			'1' &&
		discussionLayer.querySelector<HTMLButtonElement>(
			'[data-offline-branch-toggle="2"]',
		)?.parentElement?.closest('.ldp-post')?.getAttribute('data-post-number') ===
			'2' &&
		discussionLayer.querySelector(
			'[data-offline-branch-toggle="1"] [data-icon="minus"]',
		) !== null &&
		discussionLayer.querySelector(
			'.ldp-offline-discussion-close [data-icon="chevron-left"]',
		) !== null &&
		discussionLayer.querySelector('.ldp-offline-branch-controls') === null,
	'完整分支浮窗必须从当前父楼开始，并为每一级父分支保留自己的减号',
);
discussionLayer.querySelector<HTMLButtonElement>(
	'.ldp-offline-discussion-close',
)!.click();
assert(discussionLayer.hidden, '完整分支浮窗必须可独立关闭');
collapsedRoot.querySelector<HTMLButtonElement>(
	'.ldp-offline-branch-toggle',
)!.click();
mounted.flushFrames();
const expandedRoot = mounted.document.querySelector<HTMLElement>('#post_1')!;
assert(
		expandedRoot.querySelector<HTMLButtonElement>(
			'[data-offline-branch-toggle="1"]',
		)?.dataset.offlineBranchState === 'expanded' &&
		[...expandedRoot.querySelectorAll<HTMLButtonElement>(
			'.ldp-offline-branch-toggle',
		)].filter((toggle) => !toggle.hidden).length === 2 &&
	mounted.document.querySelector('#post_3') !== null,
	'点击加号必须恢复递归树与已下载正文',
);

const selectedResult = createReaderTopicOfflineDocument({
	topicId: 10,
	title: '自定义楼层上下文',
	sourceUrl: 'https://linux.do/t/offline-topic/10',
	topic,
	posts,
	mainPostNumbers: Object.freeze([3]),
	projectionMode: 'custom',
	expectedPostCount: 1,
	complete: true,
	archive: Object.freeze({ topic: null, posts: Object.freeze([]) }),
	stylesheet: '.reader-runtime-style { color: red; }',
	generatedAt: 2_000,
});
assert(
	selectedResult.postCount === 1 &&
		selectedResult.expectedPostCount === 1 &&
		selectedResult.complete,
	'自定义下载的覆盖度必须按所选锚点计算，不能把附带上下文误算成所选楼层',
);
const selectedMounted = mountOfflineRuntime(selectedResult.html);
selectedMounted.flushFrames();
const selectedRoots = [...selectedMounted.document.querySelectorAll<HTMLElement>(
	'#ldp-offline-posts > .ldp-post',
)];
const selectedDiscussionButton = selectedRoots[0]?.querySelector<HTMLButtonElement>(
	'[data-offline-discussion-kind="context"]',
);
assert(
	selectedRoots.map((post) => post.dataset.postNumber).join(',') === '3' &&
		selectedDiscussionButton?.textContent === '查看完整讨论' &&
		selectedDiscussionButton.querySelector('[data-icon="layers"]') !== null &&
		selectedMounted.document.querySelector('#post_2') === null,
	'自定义下载主流必须像只看楼主一样只显示所选楼层，并提供完整讨论入口',
);
selectedDiscussionButton.click();
const selectedDiscussionLayer = selectedMounted.document.querySelector<HTMLElement>(
	'.ldp-offline-discussion-layer',
)!;
assert(
	selectedDiscussionLayer.dataset.offlineDiscussionKind === 'context' &&
		selectedDiscussionLayer.dataset.offlineDiscussionTarget === '3' &&
		selectedDiscussionLayer.dataset.offlineBranchRoot === '2' &&
		[...selectedDiscussionLayer.querySelectorAll<HTMLElement>(
			'.ldp-offline-discussion-post',
		)].map((post) => post.dataset.postNumber).join(',') === '2,3' &&
		selectedDiscussionLayer.querySelector<HTMLButtonElement>(
			'[data-offline-branch-toggle="2"]',
		)?.parentElement?.closest('.ldp-post')?.getAttribute('data-post-number') ===
			'2' &&
		[...selectedDiscussionLayer.querySelectorAll<HTMLButtonElement>(
			'.ldp-offline-branch-toggle',
		)].filter((toggle) => !toggle.hidden).length === 1,
	'所选楼层的离线 HTML 必须携带完整上下文，单回复讨论只在子头像上方保留一个减号',
);
assert(
	selectedDiscussionLayer.querySelector(
		'#ldp-offline-discussion-post-3.ldp-segmented-branch-last',
	) !== null &&
		selectedDiscussionLayer.querySelector(
			'#ldp-offline-discussion-post-2.ldp-segmented-branch-last',
		) === null,
	'完整讨论必须标记每个父分支的末子节点，让绿色回复线在末子头像处收尾',
);
const fullOnlyOpMounted = mountOfflineRuntime(result.html);
fullOnlyOpMounted.flushFrames();
const fullOnlyOpToggle = fullOnlyOpMounted.document.querySelector<
	HTMLButtonElement
>('#ldp-offline-only-op')!;
assert(
	fullOnlyOpToggle.getAttribute('aria-pressed') === 'false' &&
		!fullOnlyOpToggle.classList.contains('active') &&
		fullOnlyOpMounted.document.querySelector('#post_2') !== null,
	'完整版离线 HTML 初始必须显示全部楼层，并在冻结标题工具卡中提供只看楼主入口',
);
fullOnlyOpToggle.click();
fullOnlyOpMounted.flushFrames();
assert(
	fullOnlyOpToggle.getAttribute('aria-pressed') === 'true' &&
		fullOnlyOpToggle.classList.contains('active') &&
		fullOnlyOpMounted.document.querySelector('#post_1') !== null &&
		fullOnlyOpMounted.document.querySelector('#post_2') === null &&
		fullOnlyOpMounted.document.querySelector('#ldp-offline-status')
			?.textContent?.includes('只看楼主 1/4') === true &&
		fullOnlyOpMounted.document.querySelector('#ldp-offline-tool-status')
			?.textContent === '',
	'完整版离线 HTML 必须在本地即时切换为只看楼主，不删除完整正文上下文',
);
fullOnlyOpToggle.click();
fullOnlyOpMounted.flushFrames();
assert(
	fullOnlyOpToggle.getAttribute('aria-pressed') === 'false' &&
		fullOnlyOpMounted.document.querySelector('#post_2') !== null &&
		fullOnlyOpMounted.document.querySelector('#ldp-offline-tool-status')
			?.textContent === '',
	'退出只看楼主后必须恢复完整版离线正文树',
);
const onlyOpResult = createReaderTopicOfflineDocument({
	topicId: 10,
	title: '只看楼主离线正文',
	sourceUrl: 'https://linux.do/t/offline-topic/10',
	topic,
	posts,
	mainPostNumbers: Object.freeze([1]),
	projectionMode: 'op',
	expectedPostCount: 1,
	complete: true,
	archive: Object.freeze({ topic: null, posts: Object.freeze([]) }),
	stylesheet: '.reader-runtime-style { color: red; }',
	generatedAt: 2_000,
});
const onlyOpMounted = mountOfflineRuntime(onlyOpResult.html);
onlyOpMounted.flushFrames();
const onlyOpRoots = [...onlyOpMounted.document.querySelectorAll<HTMLElement>(
	'#ldp-offline-posts > .ldp-post',
)];
assert(
	onlyOpResult.postCount === 1 &&
		onlyOpRoots.map((post) => post.dataset.postNumber).join(',') === '1' &&
		onlyOpMounted.document.querySelector('#post_2') === null &&
		onlyOpMounted.document.querySelector('#ldp-offline-status')
			?.textContent?.includes('只看楼主 1/3') === true,
	'历史只看楼主离线 HTML 必须继续读取旧投影，并允许恢复完整讨论上下文',
);
const onlyOpSearchInput = onlyOpMounted.document.querySelector<HTMLInputElement>(
	'#ldp-offline-search-input',
)!;
onlyOpSearchInput.value = '第二楼正文完整内容';
onlyOpSearchInput.dispatchEvent(new onlyOpMounted.window.Event('input'));
onlyOpMounted.document.querySelector<HTMLButtonElement>(
	'[data-offline-search-post="2"]',
)!.click();
onlyOpMounted.flushFrames();
const onlyOpDiscussionLayer = onlyOpMounted.document.querySelector<HTMLElement>(
	'.ldp-offline-discussion-layer',
)!;
assert(
	!onlyOpDiscussionLayer.hidden &&
		onlyOpDiscussionLayer.dataset.offlineDiscussionTarget === '2' &&
		onlyOpDiscussionLayer.querySelector(
			'[data-post-number="2"].ldp-offline-jump-highlight',
		) !== null,
	'只看楼主离线版搜索到讨论正文时，必须打开完整讨论并定位目标楼层',
);
const deepPosts: readonly TestPost[] = Object.freeze(Array.from(
	{ length: 5 },
	(_, index): TestPost => Object.freeze({
		id: 200 + index,
		post_number: index + 1,
		reply_to_post_number: index === 0 ? null : index,
		username: index === 0 ? 'deep-op' : `deep-${index + 1}`,
		name: `Deep ${index + 1}`,
		avatar_template: '',
		created_at: '2026-08-09T00:00:00.000Z',
		cooked: `<p>深层回复 ${index + 1}</p>`,
	}),
));
const deepResult = createReaderTopicOfflineDocument({
	topicId: 11,
	title: '按设置逐层展开',
	sourceUrl: 'https://linux.do/t/deep/11',
	topic: Object.freeze({
		id: 11,
		slug: 'deep',
		posts_count: 5,
		post_stream: Object.freeze({
			stream: Object.freeze(deepPosts.map((post) => post.id)),
			posts: deepPosts,
		}),
	}),
	posts: deepPosts,
	expectedPostCount: 5,
	complete: true,
	archive: Object.freeze({ topic: null, posts: Object.freeze([]) }),
	inlineReplyTreeMaxDepth: 2,
	stylesheet: '',
});
const deepMounted = mountOfflineRuntime(deepResult.html);
deepMounted.flushFrames();
assert(
	deepMounted.document.querySelector('#post_3') !== null &&
		deepMounted.document.querySelector('#post_4') === null &&
		deepMounted.document.querySelector<HTMLButtonElement>(
			'#post_3 > [data-offline-branch-toggle="3"]',
		)?.dataset.offlineBranchState === 'collapsed' &&
		deepMounted.document.querySelector<HTMLButtonElement>(
			'#post_1 > .ldp-reply-tree > [data-offline-branch-toggle="1"]',
		)?.dataset.offlineBranchState === 'expanded' &&
		deepMounted.document.querySelector<HTMLButtonElement>(
			'#post_2 > .ldp-reply-tree > [data-offline-branch-toggle="2"]',
		)?.dataset.offlineBranchState === 'expanded' &&
		deepMounted.document.querySelector<HTMLButtonElement>(
			'#post_2 > .ldp-reply-tree > [data-offline-branch-toggle="2"]',
		)?.classList.contains('ldp-offline-branch-first-child-anchor') === true &&
		deepMounted.document.querySelector<HTMLButtonElement>(
			'#post_3 > .ldp-offline-branch-discussion',
		)?.hidden === false &&
		deepMounted.document.querySelector<HTMLButtonElement>(
			'#post_2 > .ldp-offline-branch-discussion',
		)?.hidden === true &&
		deepMounted.document.querySelector<HTMLButtonElement>(
			'#post_2 .ldp-offline-context-discussion',
		)?.hidden === false,
	'离线树初始深度必须读取设置；加号旁显示完整分支，连续树末尾显示完整讨论',
);
const deepOfflineStyles = [...deepMounted.document.querySelectorAll('style')]
	.map((style) => style.textContent ?? '')
	.join('\n');
assert(
	deepOfflineStyles.includes('--ldp-offline-branch-anchor-offset, 0px') &&
		deepOfflineStyles.includes(
			'left: calc(var(--ldp-thread-avatar-size) / -2) !important',
		),
	'子楼自身收起时，父级减号必须以离线锚点覆盖通用收起行的 inset important',
);
deepMounted.document.querySelector<HTMLButtonElement>(
	'#post_3 > .ldp-offline-branch-toggle',
)!.click();
deepMounted.flushFrames();
assert(
	deepMounted.document.querySelector('#post_4') !== null &&
		deepMounted.document.querySelector('#post_5') === null &&
		deepMounted.document.querySelector<HTMLButtonElement>(
			'#post_3 > .ldp-reply-tree > [data-offline-branch-toggle="3"]',
		)?.dataset.offlineBranchState === 'expanded' &&
		deepMounted.document.querySelector<HTMLButtonElement>(
			'#post_4 > [data-offline-branch-toggle="4"]',
		)?.dataset.offlineBranchState === 'collapsed' &&
		[...deepMounted.document.querySelectorAll<HTMLButtonElement>(
			'.ldp-offline-branch-toggle[aria-expanded="true"]',
		)].filter((toggle) => !toggle.hidden).length === 3,
	'点击加号后每一级父分支都保留自己的减号，更深后代仍停在自己的加号后',
);
deepMounted.document.querySelector<HTMLButtonElement>(
	'#post_4 > .ldp-offline-branch-discussion',
)!.click();
const deepDiscussionLayer = deepMounted.document.querySelector<HTMLElement>(
	'.ldp-offline-discussion-layer',
)!;
assert(
	deepDiscussionLayer.dataset.offlineBranchRoot === '4' &&
		deepDiscussionLayer.querySelectorAll('.ldp-offline-discussion-post').length === 2 &&
		[...deepDiscussionLayer.querySelectorAll<HTMLButtonElement>(
			'.ldp-offline-branch-toggle',
		)].filter((toggle) => !toggle.hidden).length === 1 &&
		deepDiscussionLayer.querySelector<HTMLButtonElement>(
			'[data-offline-branch-toggle="4"]',
		)?.parentElement?.closest('.ldp-post')?.getAttribute('data-post-number') ===
			'4',
	`完整分支必须包含当前父楼及其全部子孙，叶楼不生成自己的异常减号：${
		JSON.stringify({
			root: deepDiscussionLayer.dataset.offlineBranchRoot,
			posts: deepDiscussionLayer.querySelectorAll(
				'.ldp-offline-discussion-post',
			).length,
			visibleToggles: [...deepDiscussionLayer.querySelectorAll<HTMLButtonElement>(
				'.ldp-offline-branch-toggle',
				)].filter((toggle) => !toggle.hidden).map((toggle) => ({
					owner: toggle.dataset.offlineBranchToggle,
					parent: toggle.parentElement?.closest('.ldp-post')
						?.getAttribute('data-post-number'),
				classes: toggle.className,
			})),
		})
	}`,
);
deepDiscussionLayer.querySelector<HTMLButtonElement>(
	'.ldp-offline-discussion-close',
)!.click();
deepMounted.document.querySelector<HTMLButtonElement>(
	'#post_4 > .ldp-offline-branch-toggle',
)!.click();
deepMounted.flushFrames();
assert(
	deepMounted.document.querySelector('#post_5') !== null &&
		deepMounted.document.querySelector(
			'#post_5 > [data-offline-branch-toggle="5"]',
		) === null &&
		deepMounted.document.querySelector<HTMLButtonElement>(
			'#post_4 > .ldp-reply-tree > [data-offline-branch-toggle="4"]',
		)?.dataset.offlineBranchState === 'expanded' &&
		deepMounted.document.querySelector(
			'#post_5 > .ldp-offline-branch-discussion',
		) === null,
	'叶节点不能生成自己的加减号或分支入口，父分支控件必须仍归父节点所有',
);
mounted.flushIdle(4);
mounted.flushFrames();
const currentRoot = mounted.document.querySelector<HTMLElement>('#post_1')!;
const currentChild = mounted.document.querySelector<HTMLElement>('#post_2')!;
const currentGrandchild = mounted.document.querySelector<HTMLElement>('#post_3')!;
const normalizedImage = currentRoot.querySelector<HTMLImageElement>(
	'.ldp-content img[data-orig-src]',
);
const imageFrame = currentRoot.querySelector<HTMLElement>(
	'.ldp-offline-image-frame',
)!;
const readOnlyProjectionContract = Object.freeze({
	titleEmoji: mounted.document.querySelector<HTMLImageElement>(
		'#ldp-offline-title img.ldp-offline-inline-emoji',
	)?.src === 'https://linux.do/images/emoji/twitter/penguin.png',
	contentEmoji: currentRoot.querySelector<HTMLImageElement>(
		'.ldp-content img.ldp-offline-inline-emoji',
	)?.src === 'https://linux.do/images/emoji/twitter/penguin.png',
	codeShortcodePreserved: currentRoot.querySelector('code')?.textContent
		?.includes(':penguin:') === true &&
		currentRoot.querySelector('code img.ldp-offline-inline-emoji') === null,
	avatar: currentRoot.querySelector('.ldp-avatar-link .ldp-avatar') !== null,
	avatarProfile: currentRoot.querySelector<HTMLAnchorElement>(
		'.ldp-avatar-link',
	)?.href === 'https://linux.do/u/op',
	author: currentRoot.querySelector('.ldp-author')?.textContent === 'Owner',
	authorProfile: currentRoot.querySelector<HTMLAnchorElement>('.ldp-author')
		?.href === 'https://linux.do/u/op',
	username: currentRoot.querySelector('.ldp-user')?.textContent === '@op',
	op: currentRoot.querySelector('.ldp-op')?.textContent === 'OP',
	time: currentRoot.querySelector('.ldp-time[data-exact-time]') !== null,
	floor: currentRoot.querySelector('.ldp-floor')?.textContent === '#1',
	exactTimeAfterFloor: currentRoot.querySelector(
		'.ldp-floor + .ldp-time-exact[aria-hidden="true"]',
	) !== null,
	boost: currentRoot.querySelector('.ldp-offline-boost-bubble')?.textContent
		?.includes('这条 Boost 也属于正文快照') === true,
	boostAvatar: currentRoot.querySelector<HTMLImageElement>('.ldp-boost-avatar')
		?.src === 'https://linux.do/user_avatar/linux.do/booster/24/1.png',
	boostAvatarProfile: currentRoot.querySelector<HTMLAnchorElement>(
		'.ldp-offline-boost-bubble .ldp-boost-avatar-link',
	)?.href === 'https://linux.do/u/booster' &&
		currentRoot.querySelector<HTMLAnchorElement>(
			'.ldp-offline-boost-bubble .ldp-boost-avatar-link',
		)?.target === '_blank',
	heart: currentRoot.querySelector('[data-reaction="heart"]')?.textContent
		?.includes('3') === true,
	clap: currentRoot.querySelector('[data-reaction="clap"]')?.textContent
		?.includes('2') === true,
	heartEmoji: currentRoot.querySelector<HTMLImageElement>(
		'[data-reaction="heart"] img.emoji',
	)?.src === 'https://linux.do/images/emoji/twitter/heart.png',
	customReactionEmoji: currentRoot.querySelector<HTMLImageElement>(
		'[data-reaction="distorted_face"] img.emoji',
	)?.src === 'https://linux.do/images/emoji/twitter/distorted_face.png',
	customReactionFieldHidden:
		currentRoot.querySelector('[data-reaction="distorted_face"]')?.textContent
			?.includes(':distorted_face:') === false,
	readOnlyReactions:
		currentRoot.querySelector('.ldp-offline-reaction-chip button') === null,
	archive: currentChild.querySelector('.ldp-post-local-archive-note')?.textContent
		?.startsWith('本地缓存 · 410 前正文 · ') === true &&
		currentChild.querySelector('.ldp-post-local-archive-note')?.textContent
			?.endsWith('确认（已隐藏）') === true &&
		currentChild.querySelector(
			'.ldp-post-local-archive-note > .ldp-post-local-archive-subtext',
		)?.textContent === '（已隐藏）' &&
		currentChild.querySelector('.ldp-post-head .ldp-hidden-badge') === null &&
		currentChild.querySelector(
			'.ldp-content + .ldp-post-body-layer > .ldp-post-local-archive-note',
		) !== null &&
		currentChild.querySelector('.ldp-offline-reactions') === null,
	poll: currentChild.querySelector('.ldp-reader-poll .ldp-poll-result') !== null,
	pollMeta: currentChild.querySelector('.ldp-poll-meta')?.textContent
		?.includes('3 位投票人') === true,
	readOnlyPoll: currentChild.querySelector('.ldp-reader-poll button') === null,
	postVotingScore:
		currentChild.querySelector('.ldp-offline-pv-votes .ldp-pv-score')
			?.textContent === '7',
	postVotingComment: currentChild.querySelector('.ldp-offline-pv-comments')
		?.textContent?.includes('离线投票评论') === true,
	readOnlyPostVoting:
		currentChild.querySelector('.ldp-offline-pv-comments button') === null,
	solvedAnswer: currentRoot.querySelector('.ldp-offline-solved-card')
		?.textContent?.includes('第三楼树状正文') === true,
	readOnlySolvedAnswer:
		currentRoot.querySelector('.ldp-offline-solved-card button') === null,
	eventTitle: currentGrandchild.querySelector(
		'.ldp-event-card .ldp-event-title',
	)?.textContent === '离线活动',
	eventLocation: currentGrandchild.querySelector('.ldp-event-card')?.textContent
		?.includes('线上') === true,
	eventStats: currentGrandchild.querySelector('.ldp-event-meta')?.textContent
		?.includes('参加 2') === true,
	readOnlyEvent: currentGrandchild.querySelector('.ldp-event-actions') === null,
	originalImage: normalizedImage?.src === 'https://linux.do/original.png',
	customEmoji: currentRoot.querySelector<HTMLImageElement>('img.emoji-custom')
		?.src === 'https://linux.do/images/emoji/twitter/sparkling_heart.png',
	noOptimizedCandidate: normalizedImage?.hasAttribute('srcset') === false,
	defaultImageScale: imageFrame.dataset.offlineImageScale === '50',
	noImageZoomToolbar:
		imageFrame.querySelector('.ldp-offline-image-toolbar') === null,
	imageZoomTitle: imageFrame.title.includes('50% / 100% / 150% / 200%') &&
		imageFrame.title.includes('Ctrl + 滚轮 ±5%'),
});
assert(
	Object.values(readOnlyProjectionContract).every(Boolean),
	`只读离线投影必须完整保留正文信息：${JSON.stringify(
		readOnlyProjectionContract,
	)}`,
);
const boostAvatar = currentRoot.querySelector<HTMLImageElement>(
	'.ldp-offline-boost-bubble .ldp-boost-avatar',
)!;
boostAvatar.dispatchEvent(new (
	mounted.window as unknown as { readonly Event: typeof Event }
).Event('error'));
mounted.flushFrames();
assert(
	currentRoot.querySelector(
		'.ldp-offline-boost-bubble .ldp-boost-avatar',
	) === null &&
		currentRoot.querySelector(
			'.ldp-offline-boost-bubble .ldp-boost-fallback-icon',
		)?.textContent === '🚀' &&
		result.html.includes(
			'[data-offline-reader] .ldp-offline-image-frame [data-offline-image-error]',
		),
	'Boost 头像加载失败时必须换成固定尺寸兜底，且通用大图错误占位不得作用于头像',
);
const imageClick = (): Event => {
	const event = new (
		mounted.window as unknown as { readonly Event: typeof Event }
	).Event('click', { bubbles: true, cancelable: true });
	normalizedImage!.dispatchEvent(event);
	return event;
};
const firstImageClick = imageClick();
assert(
	firstImageClick.defaultPrevented &&
		String(imageFrame.dataset.offlineImageScale) === '100',
	'点击图片必须从默认 50% 切换到 100%，并阻止原图链接抢走点击',
);
imageClick();
assert(
	String(imageFrame.dataset.offlineImageScale) === '150',
	'第二次点击图片必须切换到 150%',
);
imageClick();
assert(
	String(imageFrame.dataset.offlineImageScale) === '200',
	'第三次点击图片必须切换到最大 200%',
);
imageClick();
assert(
	String(imageFrame.dataset.offlineImageScale) === '50',
	'达到 200% 后再次点击必须轮转回 50%',
);
const imageWheel = new (
	mounted.window as unknown as { readonly Event: typeof Event }
).Event('wheel', { bubbles: true, cancelable: true });
Object.defineProperties(imageWheel, {
	ctrlKey: { value: true },
	deltaY: { value: -1 },
});
imageFrame.dispatchEvent(imageWheel);
assert(
	imageWheel.defaultPrevented &&
		String(imageFrame.dataset.offlineImageScale) === '55',
	'Ctrl+滚轮每格必须从当前比例精细增加 5%，不能在预设间跳转',
);
const imageWheelDown = new (
	mounted.window as unknown as { readonly Event: typeof Event }
).Event('wheel', { bubbles: true, cancelable: true });
Object.defineProperties(imageWheelDown, {
	ctrlKey: { value: true },
	deltaY: { value: 1 },
});
for (let index = 0; index < 3; index += 1) {
	imageFrame.dispatchEvent(imageWheelDown);
}
assert(
	String(imageFrame.dataset.offlineImageScale) === '50',
	'Ctrl+滚轮缩小必须严格停在最小 50%',
);
imageClick();
imageClick();
imageClick();
imageFrame.dispatchEvent(imageWheel);
assert(
	String(imageFrame.dataset.offlineImageScale) === '200' &&
		imageFrame.querySelector('.ldp-offline-image-toolbar') === null,
	'Ctrl+滚轮放大必须严格停在最大 200%，且不能重新生成缩放组件',
);
assert(
	mounted.document.querySelector('.ldp-post-actions') === null &&
		mounted.document.querySelector(
			'.ldp-reactions:not(.ldp-offline-reactions)',
		) === null &&
		mounted.document.querySelector('.ldp-topic-footer-slot') === null &&
		mounted.document.querySelector('.ldp-reply-controls') !== null &&
		mounted.document.querySelector(
			'.ldp-reply-controls > :not(.ldp-offline-context-discussion)',
		) === null &&
		mounted.document.querySelector('.ldp-head-btns') === null &&
		mounted.document.querySelector('.ldp-title-actions') === null &&
		mounted.document.querySelector('[class*="ldp-history"]') === null &&
		mounted.document.querySelector('[class*="ldp-settings"]') === null,
	'离线 HTML 不得生成收藏、历史、设置、回复或楼层动作等失效功能层',
);

const longPosts: readonly TestPost[] = Object.freeze(Array.from(
	{ length: 1_000 },
	(_, index): TestPost => {
		const postNumber = index + 1;
		return Object.freeze({
			id: 10_000 + postNumber,
			post_number: postNumber,
			reply_to_post_number: postNumber === 1 ? null : 1,
			username: postNumber === 1 ? 'long-op' : `member-${postNumber}`,
			name: postNumber === 1 ? 'Long Owner' : `Member ${postNumber}`,
			avatar_template: '',
			created_at: '2026-08-09T00:00:00.000Z',
			cooked: `<p>巨长主题第 ${postNumber} 楼正文</p>`,
		});
	},
));
const longTopic: TestTopic = {
	id: 20,
	slug: 'long-offline-topic',
	posts_count: longPosts.length,
	post_stream: {
		stream: Object.freeze(longPosts.map((post) => post.id)),
		posts: longPosts,
	},
};
const longResult = createReaderTopicOfflineDocument({
	topicId: 20,
	title: '巨长离线主题',
	sourceUrl: 'https://linux.do/t/long-offline-topic/20',
	topic: longTopic,
	posts: longPosts,
	expectedPostCount: longPosts.length,
	complete: true,
	archive: Object.freeze({ topic: null, posts: Object.freeze([]) }),
	stylesheet: '',
	generatedAt: 2_000,
});
const longMounted = mountOfflineRuntime(longResult.html, {
	height: 600,
	width: 1_200,
});
longMounted.flushFrames();
const initialPostCount = longMounted.document.querySelectorAll(
	'#ldp-offline-posts .ldp-post',
).length;
const initialPendingCount = longMounted.document.querySelectorAll(
	'#ldp-offline-posts .ldp-post-projection-pending',
).length;
assert(
	initialPostCount <= 65 &&
		initialPendingCount > 0 &&
		longMounted.document.querySelector(
			'#ldp-offline-posts [data-ldp-content-hydrated="1"]',
		) !== null,
	`千楼主题首屏只能挂载预算内 DOM，并同步填充可见正文、近窗保持骨架：posts=${
		initialPostCount
	}, pending=${initialPendingCount}`,
);
const longRootToggle = longMounted.document.querySelector<HTMLButtonElement>(
	'#post_1 .ldp-offline-branch-toggle',
)!;
longRootToggle.click();
longMounted.flushFrames();
assert(
	longMounted.document.querySelectorAll('#ldp-offline-posts .ldp-post').length === 1 &&
		longMounted.document.querySelector<HTMLButtonElement>(
			'#post_1 .ldp-offline-branch-toggle',
		)?.dataset.offlineBranchState === 'collapsed',
	'千楼树收纳后必须只保留父楼 DOM，不能继续物化隐藏正文',
);
longMounted.document.querySelector<HTMLButtonElement>(
	'#post_1 .ldp-offline-branch-toggle',
)!.click();
longMounted.flushFrames();
assert(
	longMounted.document.querySelectorAll('#ldp-offline-posts .ldp-post').length <= 65,
	'千楼树重新展开后仍必须回到虚拟 DOM 预算内',
);
longMounted.viewport.scrollTop = 120_000;
const OfflineEvent = (
	longMounted.window as unknown as { readonly Event: typeof Event }
).Event;
longMounted.viewport.dispatchEvent(new OfflineEvent('scroll'));
longMounted.flushFrames();
const scrolledPostCount = longMounted.document.querySelectorAll(
	'#ldp-offline-posts .ldp-post',
).length;
const scrolledRoot = longMounted.document.querySelector<HTMLElement>(
	'#ldp-offline-posts > .ldp-post[data-post-number="1"]',
);
const scrolledVisible = longMounted.document.querySelector<HTMLElement>(
	'#ldp-offline-posts [data-ldp-content-hydrated="1"][data-parent-post-number="1"]',
);
const beforeSpacer = longMounted.document.querySelector<HTMLElement>(
	'#ldp-offline-before',
);
const scrolledRootToggle = longMounted.document.querySelector<HTMLButtonElement>(
	'#post_1 [data-offline-branch-toggle="1"]',
);
const nestedVirtualSpacer = longMounted.document.querySelector<HTMLElement>(
	'.ldp-tree-virtual-spacer',
);
assert(
	scrolledPostCount <= 65 &&
		scrolledRoot?.classList.contains('ldp-virtual-ancestor-shell') === true &&
		Number(scrolledVisible?.dataset.postNumber) > 500 &&
		Number.parseFloat(beforeSpacer?.style.blockSize || '0') === 0 &&
		scrolledRootToggle?.hidden === false &&
		scrolledRootToggle?.parentElement?.classList.contains('ldp-reply-tree') ===
			true &&
		Number.parseFloat(
			scrolledRootToggle?.style.getPropertyValue(
				'--ldp-offline-branch-anchor-offset',
			) || '0',
		) > 0 &&
		Number.parseFloat(nestedVirtualSpacer?.style.blockSize || '0') > 0,
	`跳到巨长回复树中段时必须回收远端正文、保留祖先壳和总高度：posts=${
		scrolledPostCount
	}, visible=${scrolledVisible?.dataset.postNumber}, before=${
		beforeSpacer?.style.blockSize
		}, toggle=${JSON.stringify({
			hidden: scrolledRootToggle?.hidden,
			owner: scrolledRootToggle?.dataset.offlineBranchToggle,
			offset: scrolledRootToggle?.style.getPropertyValue(
				'--ldp-offline-branch-anchor-offset',
			),
	})}, treeSpacer=${nestedVirtualSpacer?.style.blockSize}`,
);
const pendingBeforeIdle = longMounted.document.querySelectorAll(
	'#ldp-offline-posts .ldp-post-projection-pending',
).length;
longMounted.flushIdle();
longMounted.flushFrames();
const pendingAfterIdle = longMounted.document.querySelectorAll(
	'#ldp-offline-posts .ldp-post-projection-pending',
).length;
assert(
	pendingAfterIdle < pendingBeforeIdle &&
		longMounted.document.querySelectorAll('#ldp-offline-posts .ldp-post').length <= 65,
	`近窗正文必须在空闲批次增量水合，且不能突破 DOM 预算：${
		pendingBeforeIdle
	} -> ${pendingAfterIdle}`,
);
