import { parseHTML } from 'linkedom';
import {
	ReaderTranslationController,
} from '../src/translation/reader-translation-controller.js';
import type {
	TranslationBatchPort,
} from '../src/translation/translation-request-adapter.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class FakeTranslator implements TranslationBatchPort {
	readonly batches: string[][] = [];
	async translate(
		texts: readonly string[],
		_signal: AbortSignal,
		options?: Parameters<TranslationBatchPort['translate']>[2],
	): Promise<readonly string[]> {
		this.batches.push([...texts]);
		const translations = texts.map((text) => `译：${text}`);
		translations.forEach((translation, index) =>
			options?.onProgress?.(index, translation));
		return translations;
	}
}

const { document: parsedDocument, window } = parseHTML(
	'<!doctype html><html><body>' +
	'<main class="comments">' +
	'<article class="ldp-post" data-username="member">' +
	'<div class="ldp-content"><p>This is the main English paragraph for ' +
	'<a class="mention" href="/u/alice">@alice</a> and translation.</p>' +
	'<p class="ldp-post-quote">This quoted English paragraph must stay original.</p></div>' +
	'<section class="ldp-solved-card"><div class="ldp-solved-excerpt ldp-content">' +
	'<p>This accepted answer excerpt also needs translation.</p></div></section>' +
	'</article>' +
	'<article class="ldp-post" data-username="member"><div class="ldp-content">' +
	'<p>这是一个无需翻译的中文段落。</p></div></article>' +
	'</main><aside class="discussion"></aside>' +
	'</body></html>',
);
const document = parsedDocument as unknown as Document;
const comments = document.querySelector<HTMLElement>('.comments')!;
let discussion = document.querySelector<HTMLElement>('.discussion')!;
const translator = new FakeTranslator();
const persisted: string[] = [];
const notices: string[] = [];
const visibleDelays: number[] = [];
const controller = new ReaderTranslationController({
	translator,
	surfaces: () => [comments, discussion, comments],
	initialMode: 'original',
	persistMode: (mode) => persisted.push(mode),
	startupDelayMs: 120,
	delay: async (milliseconds) => {
		visibleDelays.push(milliseconds);
	},
	isSectionVisible: () => true,
	notify: (message) => notices.push(message),
});
controller.start();
await controller.flush();
assert(translator.batches.length === 0, 'original 模式不得请求翻译');
assert(controller.cycleMode() === 'bilingual', '第一次切换必须进入双语');
await controller.flush();
assert(
	translator.batches.flat().length === 2 &&
	comments.querySelectorAll('.ldp-translation-text').length === 2 &&
	comments.querySelectorAll('.ldp-translation-loading').length === 0 &&
	comments.querySelectorAll('.ldp-translation-enter').length === 2 &&
	comments.querySelectorAll('.ldp-translation-segment').length >= 4 &&
	comments.dataset.translationAnimation === 'fade' &&
	comments.dataset.translationTheme === 'quote' &&
	visibleDelays.length === 0,
	'主正文与已解决摘录必须使用默认引用主题并播放逐词动画，可见翻译不得承担预加载启动延迟',
);
assert(
	comments.querySelector('.ldp-translation-text a.mention')
		?.getAttribute('href') === '/u/alice' &&
	comments.querySelector(
		'.ldp-translation-text a.mention .ldp-translation-segment',
	)?.textContent === '@alice',
	'翻译显示必须恢复原 @ mention 链接而不是把它压成纯文本',
);
const offlineProjection = document.createElement('div');
offlineProjection.innerHTML = '<p>This is the main English paragraph for ' +
	'<a class="mention" href="/u/alice">@alice</a> and translation.</p>';
assert(
	controller.projectKnownTranslations(offlineProjection) === 1 &&
		offlineProjection.querySelector('.ldp-translation-original') !== null &&
		offlineProjection.querySelector('.ldp-translation-text a.mention')
			?.getAttribute('href') === '/u/alice',
	'离线 cooked 必须复用已完成译文并保留受保护链接，不能触发第二套翻译实现',
);
const offlineTranslationBatchCount = translator.batches.length;
const offlineProgress: string[] = [];
const preparedOfflineTranslations = await controller.prepareOfflineTranslations(
	document,
	Object.freeze([
		Object.freeze({
			post_type: 1,
			username: 'member',
			cooked: '<p>This is the main English paragraph for ' +
				'<a class="mention" href="/u/alice">@alice</a> and translation.</p>',
		}),
		Object.freeze({
			post_type: 1,
			username: 'unmounted',
			cooked: '<p>This unmounted floor must be translated for the full ' +
				'offline Topic download.</p>',
		}),
	]),
	new AbortController().signal,
	{
		onProgress: (completed, total) => offlineProgress.push(
			`${completed}/${total}`,
		),
	},
);
assert(
	preparedOfflineTranslations.size === 2 &&
		translator.batches.length === offlineTranslationBatchCount + 1 &&
		translator.batches.at(-1)?.length === 1 &&
		offlineProgress.join(',') === '1/2,2/2',
	'全文下载必须复用已知译文并只补译尚未挂载的全部楼层 Section',
);
const completeOfflineProjection = document.createElement('div');
completeOfflineProjection.innerHTML =
	'<p>This unmounted floor must be translated for the full offline Topic download.</p>';
assert(
	controller.projectOfflineTranslations(
		completeOfflineProjection,
		preparedOfflineTranslations,
	) === 1 &&
		completeOfflineProjection.querySelector('.ldp-translation-text')
			?.textContent?.startsWith('译：') === true,
	'全文下载补齐的译文必须可由同一 DOM owner 写入离线 cooked',
);
controller.setAnimation('blur');
assert(
	String(comments.dataset.translationAnimation) === 'blur' &&
	comments.querySelectorAll('.ldp-translation-segment').length === 0,
	'切换译文动画必须立即投影到已登记 surface，并释放上一轮临时逐词 DOM',
);
controller.setTheme('dividing-line');
assert(
	controller.theme === 'dividing-line' &&
	comments.dataset.translationTheme === 'dividing-line' &&
	discussion.dataset.translationTheme === 'dividing-line',
	'切换译文主题必须立即投影到全部已登记 surface',
);
assert(
	comments.classList.contains('ldp-translation-active') &&
	!comments.classList.contains('ldp-translation-only'),
	'双语 surface class 错误',
);

discussion.innerHTML =
	'<article class="ldp-post" data-username="popup"><div class="ldp-content">' +
	'<p>This dynamically inserted discussion reply needs translation.</p></div></article>';
controller.syncPost(discussion.querySelector<HTMLElement>('.ldp-post')!);
await controller.flush();
assert(
	discussion.querySelector('.ldp-translation-text')?.textContent?.startsWith('译：'),
	'完整讨论异步楼层必须进入同一个翻译 owner',
);
assert(
	controller.cycleMode() === 'translation' &&
	comments.classList.contains('ldp-translation-only') &&
	discussion.classList.contains('ldp-translation-only'),
	'全译文模式必须同步全部已登记 surface',
);
assert(
	controller.cycleMode() === 'original' &&
	!comments.classList.contains('ldp-translation-active') &&
	persisted.join(',') === 'bilingual,translation,original' &&
	notices.join(',') ===
		'正文翻译：双语显示,正文翻译：全译文,已恢复原文',
	'模式切换必须统一持久化并恢复原文 class',
);
const originalOfflineProjection = document.createElement('div');
originalOfflineProjection.innerHTML = '<p>This is the main English paragraph for ' +
	'<a class="mention" href="/u/alice">@alice</a> and translation.</p>';
assert(
	controller.projectKnownTranslations(originalOfflineProjection) === 0 &&
		originalOfflineProjection.querySelector('.ldp-translation-text') === null,
	'原文设置下的离线 cooked 不得夹带译文投影',
);
controller.destroy();
assert(
	!discussion.classList.contains('ldp-translation-only'),
	'销毁必须清理动态讨论 surface 状态',
);

const foldedSurface = document.createElement('section');
document.body.append(foldedSurface);
const foldedPostHtml =
	'<div class="ldp-content"><details><summary>' +
	'This meaningful folded Prompt title needs translation.</summary>' +
	'<p>This expanded details paragraph must animate once without replaying ' +
	'when its post is remounted during scrolling.</p></details></div>';
const foldedPost = document.createElement('article');
foldedPost.className = 'ldp-post';
foldedPost.dataset.postId = '901';
foldedPost.dataset.postNumber = '9';
foldedPost.dataset.username = 'folded';
foldedPost.innerHTML = foldedPostHtml;
foldedSurface.append(foldedPost);
const foldedController = new ReaderTranslationController({
	translator: new FakeTranslator(),
	surfaces: () => [foldedSurface],
	initialMode: 'bilingual',
	startupDelayMs: 0,
	delay: async () => {},
	isSectionVisible: () => true,
});
foldedController.start();
await foldedController.flush();
const foldedDetails = foldedPost.querySelector<HTMLDetailsElement>('details')!;
const foldedBodyOutput = foldedDetails.querySelector<HTMLElement>(
	'p > .ldp-translation-text',
)!;
assert(
	foldedDetails.querySelector('summary > .ldp-translation-enter') !== null &&
	!foldedBodyOutput.classList.contains('ldp-translation-enter') &&
	foldedBodyOutput.querySelector('.ldp-translation-segment') === null,
	'关闭的 details 正文必须先消费缓存译文但延迟动画，标题仍可正常完成首次入场',
);
foldedDetails.setAttribute('open', '');
foldedDetails.dispatchEvent(new window.Event('toggle'));
assert(
	foldedBodyOutput.classList.contains('ldp-translation-enter') &&
	foldedBodyOutput.querySelector('.ldp-translation-segment') !== null,
	'details 正文必须只在首次展开且可见时开始动画',
);
foldedPost.remove();
const remountedFoldedPost = document.createElement('article');
remountedFoldedPost.className = 'ldp-post';
remountedFoldedPost.dataset.postId = '901';
remountedFoldedPost.dataset.postNumber = '9';
remountedFoldedPost.dataset.username = 'folded';
remountedFoldedPost.innerHTML = foldedPostHtml.replace('<details>', '<details open>');
foldedSurface.append(remountedFoldedPost);
foldedController.syncPost(remountedFoldedPost);
await foldedController.flush();
const remountedFoldedOutput = remountedFoldedPost.querySelector<HTMLElement>(
	'details > p > .ldp-translation-text',
)!;
assert(
	remountedFoldedOutput.textContent?.startsWith('译：') &&
	!remountedFoldedOutput.classList.contains('ldp-translation-enter') &&
	remountedFoldedOutput.querySelector('.ldp-translation-segment') === null,
	'已展开并消费过动画的 Section 在滚动重挂载后必须固定显示最终译文，不得重播',
);
foldedController.destroy();

const racePost = document.createElement('article');
racePost.className = 'ldp-post';
racePost.dataset.username = 'race';
racePost.innerHTML =
	'<div class="ldp-post-body"><div class="ldp-content">' +
	'<p>This request must not be duplicated across a rapid mode cycle.</p>' +
	'</div></div>';
document.body.append(racePost);
let releaseRace!: () => void;
const raceGate = new Promise<void>((resolve) => {
	releaseRace = resolve;
});
let raceRequests = 0;
const raceController = new ReaderTranslationController({
	translator: {
		async translate(texts) {
			raceRequests += 1;
			await raceGate;
			return texts.map((text) => `竞态译文：${text}`);
		},
	},
	surfaces: () => [document.body],
	initialMode: 'bilingual',
	startupDelayMs: 0,
	delay: async () => {},
});
raceController.start();
await Promise.resolve();
raceController.setMode('original');
raceController.setMode('bilingual');
releaseRace();
await raceController.flush();
assert(
	raceRequests === 2 &&
	racePost.querySelectorAll('.ldp-translation-text').length === 1 &&
	raceController.snapshot().queued === 0,
	'飞行中关闭翻译必须释放旧任务；恢复后重新请求一次且不得让旧结果写入或留下停滞任务',
);
raceController.destroy();

const failurePost = document.createElement('article');
failurePost.className = 'ldp-post';
failurePost.dataset.username = 'failure';
failurePost.innerHTML = '<div class="ldp-content"><p>' +
	'This complete sentence must expose a translation failure.</p></div>';
document.body.append(failurePost);
const failureNotices: string[] = [];
const failureDelays: number[] = [];
let failureAttempts = 0;
const failureController = new ReaderTranslationController({
	translator: {
		async translate(texts) {
			failureAttempts += 1;
			if (failureAttempts < 3) throw new Error('翻译请求失败');
			return texts.map((text) => `重试成功：${text}`);
		},
	},
	surfaces: () => [document.body],
	initialMode: 'bilingual',
	startupDelayMs: 0,
	delay: async (milliseconds) => {
		failureDelays.push(milliseconds);
	},
	isSectionVisible: () => true,
	notify: (message) => failureNotices.push(message),
});
failureController.start();
await failureController.flush();
assert(
	failureAttempts === 3 &&
		failureDelays.join(',') === '350,900' &&
		failureNotices.length === 0 &&
		failureController.snapshot().busy === false &&
		failurePost.querySelector('.ldp-translation-loading') === null &&
		failurePost.querySelector('.ldp-translation-text')?.textContent?.startsWith(
			'重试成功：',
		),
	'可恢复翻译失败必须退避重试两次，并在恢复后补上正文译文而不是直接放弃',
);
failureController.destroy();

const exhaustedSurface = document.createElement('section');
const exhaustedPost = document.createElement('article');
exhaustedPost.className = 'ldp-post';
exhaustedPost.dataset.username = 'exhausted';
exhaustedPost.innerHTML = '<div class="ldp-content"><p>' +
	'This sentence must remain readable after all retries are exhausted.</p></div>';
exhaustedSurface.append(exhaustedPost);
document.body.append(exhaustedSurface);
let exhaustedAttempts = 0;
const exhaustedNotices: string[] = [];
const exhaustedController = new ReaderTranslationController({
	translator: {
		async translate() {
			exhaustedAttempts += 1;
			throw new Error('翻译请求失败');
		},
	},
	surfaces: () => [exhaustedSurface],
	initialMode: 'bilingual',
	startupDelayMs: 0,
	delay: async () => {},
	isSectionVisible: () => true,
	notify: (message) => exhaustedNotices.push(message),
});
exhaustedController.start();
await exhaustedController.flush();
assert(
	exhaustedAttempts === 3 &&
	exhaustedNotices.join(',') ===
		'翻译请求失败；自动重试后仍未成功，已保留原文' &&
	exhaustedPost.querySelector('.ldp-translation-loading') === null &&
	exhaustedPost.querySelector('.ldp-translation-original')?.textContent
		?.includes('remain readable'),
	'自动重试耗尽后必须停止动画、保留原文并给出一次明确反馈',
);
exhaustedController.destroy();

const preloadParagraphs = Array.from({ length: 85 }, (_, index) =>
	`<p>This is preload paragraph number ${index} with enough English words ` +
	'to require an early translation request.</p>').join('');
let preloadActive = 0;
let preloadMaxActive = 0;
const preloadPriorities: string[] = [];
const preloadBatchSizes: number[] = [];
const preloadDelays: number[] = [];
const preloadController = new ReaderTranslationController({
	translator: {
		async translate(texts, _signal, options) {
			preloadActive += 1;
			preloadMaxActive = Math.max(preloadMaxActive, preloadActive);
			preloadPriorities.push(options?.priority ?? '');
			preloadBatchSizes.push(texts.length);
			await Promise.resolve();
			preloadActive -= 1;
			return texts.map((text) => `预译：${text}`);
		},
	},
	surfaces: () => [],
	initialMode: 'bilingual',
	startupDelayMs: 120,
	delay: async (milliseconds) => {
		preloadDelays.push(milliseconds);
	},
});
preloadController.start();
preloadController.preloadPosts(document, [{
	post_type: 1,
	username: 'preloaded-user',
	cooked: preloadParagraphs,
}]);
await preloadController.flush();
assert(
	preloadBatchSizes.join(',') === '20,20,20,20,5' &&
	preloadMaxActive === 5 &&
	preloadPriorities.every((priority) => priority === 'prefetch') &&
	preloadDelays.join(',') === '120',
	'预加载正文必须按 20 段批量、最多五个 worker 并行填充译文语料缓存',
);
preloadController.destroy();

const scrollSurface = document.createElement('section');
document.body.append(scrollSurface);
const scrollReleases: Array<() => void> = [];
const scrollPriorities: string[] = [];
let scrollActive = 0;
let scrollMaxActive = 0;
const scrollController = new ReaderTranslationController({
	translator: {
		async translate(texts, _signal, options) {
			scrollActive += 1;
			scrollMaxActive = Math.max(scrollMaxActive, scrollActive);
			scrollPriorities.push(options?.priority ?? '');
			if (options?.priority === 'prefetch') {
				await new Promise<void>((resolve) => scrollReleases.push(resolve));
			}
			scrollActive -= 1;
			return texts.map((text) => `抢先译文：${text}`);
		},
	},
	surfaces: () => [scrollSurface],
	initialMode: 'bilingual',
	startupDelayMs: 0,
	delay: async () => {},
	isSectionVisible: () => true,
});
scrollController.start();
scrollController.preloadPosts(document, [{
	post_type: 1,
	username: 'scroll-preload',
	cooked: Array.from({ length: 100 }, (_, index) =>
		`<p>Preloaded scroll corpus ${index} contains enough English words ` +
		'to be translated before it reaches the viewport.</p>').join(''),
}]);
await Promise.resolve();
await Promise.resolve();
const urgentPost = document.createElement('article');
urgentPost.className = 'ldp-post';
urgentPost.dataset.username = 'urgent-visible';
urgentPost.innerHTML = '<div class="ldp-content"><p>' +
	'This newly visible paragraph must bypass the busy preload workers.</p></div>';
scrollSurface.append(urgentPost);
scrollController.syncPost(urgentPost);
await Promise.resolve();
await Promise.resolve();
assert(
	scrollReleases.length === 5 &&
	scrollMaxActive === 6 &&
	scrollPriorities.filter((priority) => priority === 'prefetch').length === 5 &&
	scrollPriorities.at(-1) === 'visible' &&
	urgentPost.querySelector('.ldp-translation-text')?.textContent?.startsWith(
		'抢先译文：',
	),
	'五路预加载繁忙时必须启动第六路可见正文急行 worker，不能让滚动正文排在语料库后面',
);
scrollReleases.forEach((release) => release());
await scrollController.flush();
scrollController.destroy();

const sharedSurface = document.createElement('section');
document.body.append(sharedSurface);
let releaseShared!: () => void;
const sharedGate = new Promise<void>((resolve) => {
	releaseShared = resolve;
});
let sharedRequests = 0;
const sharedText = 'This in-flight preloaded paragraph must be reused when mounted.';
const sharedController = new ReaderTranslationController({
	translator: {
		async translate(texts) {
			sharedRequests += 1;
			await sharedGate;
			return texts.map((text) => `复用译文：${text}`);
		},
	},
	surfaces: () => [sharedSurface],
	initialMode: 'bilingual',
	startupDelayMs: 0,
	delay: async () => {},
});
sharedController.start();
sharedController.preloadPosts(document, [{
	post_type: 1,
	username: 'shared-preload',
	cooked: `<p>${sharedText}</p>`,
}]);
await Promise.resolve();
const sharedPost = document.createElement('article');
sharedPost.className = 'ldp-post';
sharedPost.dataset.username = 'shared-visible';
sharedPost.innerHTML = `<div class="ldp-content"><p>${sharedText}</p></div>`;
sharedSurface.append(sharedPost);
sharedController.syncPost(sharedPost);
assert(sharedRequests === 1, '挂载正在预译的 Section 不得再发第二次翻译请求');
releaseShared();
await sharedController.flush();
assert(
	sharedPost.querySelector('.ldp-translation-text')?.textContent?.startsWith(
		'复用译文：',
	),
	'正在预译的 Section 挂载后必须订阅同一在途结果并直接消费译文',
);
sharedController.destroy();

const lifecycleSignals: AbortSignal[] = [];
const lifecycleBatches: string[][] = [];
const lifecycleController = new ReaderTranslationController({
	translator: {
		async translate(texts, signal) {
			lifecycleBatches.push([...texts]);
			if (texts.some((text) => text.includes('current topic sentence'))) {
				return texts.map((text) => `新帖译文：${text}`);
			}
			lifecycleSignals.push(signal);
			return new Promise<readonly string[]>((_resolve, reject) => {
				signal.addEventListener('abort', () => reject(signal.reason), {
					once: true,
				});
			});
		},
	},
	surfaces: () => [],
	initialMode: 'bilingual',
	startupDelayMs: 0,
	delay: async () => {},
});
lifecycleController.start();
lifecycleController.activateTopic('old-topic');
lifecycleController.updatePreloadWindow(document, 'old-topic', [{
	post_type: 1,
	username: 'old-window',
	cooked: Array.from({ length: 140 }, (_, index) =>
		`<p>Old preload window sentence ${index} has enough English words ` +
		'to hold a background translation slot.</p>').join(''),
}]);
await Promise.resolve();
await Promise.resolve();
assert(
	lifecycleSignals.length === 5 &&
	lifecycleController.snapshot().queued === 40,
	'旧窗口预加载最多占五路，超出部分只能留在可撤销后台队列',
);
lifecycleController.updatePreloadWindow(document, 'old-topic', [{
	post_type: 1,
	username: 'replacement-window',
	cooked: '<p>The replacement window sentence should be the only queued ' +
		'prefetch item after scrolling.</p>',
}]);
assert(
	lifecycleController.snapshot().queued === 1,
	'虚拟窗口变化时必须丢弃尚未启动的窗口外预译，不能继续翻译整帖缓存',
);
const staleGeneration = lifecycleController.activateTopic('current-topic');
const currentGeneration = lifecycleController.activateTopic('current-topic');
lifecycleController.deactivateTopic('current-topic', staleGeneration);
lifecycleController.updatePreloadWindow(document, 'current-topic', [{
	post_type: 1,
	username: 'current-window',
	cooked: '<p>This current topic sentence must translate after the old ' +
		'window is cancelled.</p>',
}]);
await lifecycleController.flush();
assert(
	lifecycleSignals.every((signal) => signal.aborted) &&
	lifecycleBatches.some((batch) => batch.some((text) =>
		text.includes('current topic sentence'))) &&
	lifecycleController.snapshot().queued === 0,
	'切帖必须取消旧预译；旧 context 的延迟 cleanup 不得误伤同 Topic 的新 generation',
);
lifecycleController.deactivateTopic('current-topic', currentGeneration);
lifecycleController.destroy();
