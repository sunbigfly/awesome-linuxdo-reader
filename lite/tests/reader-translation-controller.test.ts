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
	async translate(texts: readonly string[]): Promise<readonly string[]> {
		this.batches.push([...texts]);
		return texts.map((text) => `译：${text}`);
	}
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body>' +
	'<main class="comments">' +
	'<article class="ldp-post" data-username="member">' +
	'<div class="ldp-content"><p>This is the main English paragraph for translation.</p>' +
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
const controller = new ReaderTranslationController({
	translator,
	surfaces: () => [comments, discussion, comments],
	initialMode: 'original',
	persistMode: (mode) => persisted.push(mode),
	startupDelayMs: 0,
	delay: async () => {},
	notify: (message) => notices.push(message),
});
controller.start();
await controller.flush();
assert(translator.batches.length === 0, 'original 模式不得请求翻译');
assert(controller.cycleMode() === 'bilingual', '第一次切换必须进入双语');
await controller.flush();
assert(
	translator.batches.flat().length === 2 &&
		comments.querySelectorAll('.ldp-translation-text').length === 2,
	'主正文与已解决摘录必须共用翻译队列，普通引用和中文不得进入',
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
controller.destroy();
assert(
	!discussion.classList.contains('ldp-translation-only'),
	'销毁必须清理动态讨论 surface 状态',
);

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
	raceRequests === 1 &&
	racePost.querySelectorAll('.ldp-translation-text').length === 1 &&
	raceController.snapshot().queued === 0,
	'飞行中切换原文再恢复时必须合并同文本队列，不能重复请求或留下停滞任务',
);
raceController.destroy();

const failurePost = document.createElement('article');
failurePost.className = 'ldp-post';
failurePost.dataset.username = 'failure';
failurePost.innerHTML = '<div class="ldp-content"><p>' +
	'This complete sentence must expose a translation failure.</p></div>';
document.body.append(failurePost);
const failureNotices: string[] = [];
const failureController = new ReaderTranslationController({
	translator: {
		async translate() {
			throw new Error('翻译请求失败');
		},
	},
	surfaces: () => [document.body],
	initialMode: 'bilingual',
	startupDelayMs: 0,
	delay: async () => {},
	notify: (message) => failureNotices.push(message),
});
failureController.start();
await failureController.flush();
assert(
	failureNotices.join(',') === '翻译请求失败，请稍后重试' &&
		failureController.snapshot().busy === false,
	'翻译请求失败必须显示与主线一致的反馈并释放 busy',
);
failureController.destroy();
