import { parseHTML } from 'linkedom';
import { Signal } from '../src/kernel/signal.js';
import {
	ReaderTopicLocalArchiveFeature,
} from '../src/topic/reader-topic-local-archive-feature.js';
import type {
	TopicLocalArchiveState,
} from '../src/cache/topic-snapshot-repository.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestPost {
	readonly id: number;
	readonly post_number: number;
	readonly reply_to_post_number: number | null;
}

const { document: parsedDocument } = parseHTML(`
	<!doctype html><html><body>
		<section id="topic">
			<article id="post">
				<header class="ldp-post-head">
					<span class="ldp-special-badge ldp-hidden-badge warn">已隐藏</span>
				</header>
				<div class="ldp-post-body">
				<div class="ldp-content"><p data-cached-body>已缓存正文</p></div>
				<div class="ldp-post-body-layer"></div>
			</div></article>
		</section>
	</body></html>
`);
const document = parsedDocument as unknown as Document;
const topicRoot = document.querySelector<HTMLElement>('#topic')!;
const postRoot = document.querySelector<HTMLElement>('#post')!;
const archiveChanges = new Signal<TopicLocalArchiveState>();
let state: TopicLocalArchiveState = Object.freeze({
	topic: null,
	posts: Object.freeze([]),
});
const feature = new ReaderTopicLocalArchiveFeature<TestPost>({
	document,
	topicRoot,
	session: {
		archiveChanges,
		localArchiveState: () => state,
	},
	nowLabel: (timestamp) => `time:${timestamp}`,
});
feature.attachRoot(postRoot, 2);

state = Object.freeze({
	topic: null,
	posts: Object.freeze([
		Object.freeze({ postNumber: 2, status: 404, confirmedAt: 99 }),
	]),
});
archiveChanges.emit(state);
assert(
	!topicRoot.classList.contains('is-local-archive-topic') &&
		topicRoot.querySelector<HTMLElement>(
			'.ldp-topic-local-archive-notice',
		)?.hidden === true &&
	postRoot.classList.contains('is-local-archive-post') &&
	postRoot.dataset.localArchiveStatus === '404' &&
	postRoot.querySelector(
		':scope > .ldp-post-body > .ldp-post-body-layer > .ldp-post-local-archive-note',
	)?.textContent ===
			'本地缓存 · 404 前正文 · time:99 确认（已隐藏）' &&
		postRoot.querySelector(
			'.ldp-post-local-archive-note > .ldp-post-local-archive-subtext',
		)?.textContent === '（已隐藏）' &&
		postRoot.querySelector('.ldp-post-body-layer')?.firstElementChild?.classList.contains(
			'ldp-post-local-archive-note',
		) === true &&
		postRoot.querySelector('.ldp-post-body')?.firstElementChild?.classList.contains(
			'ldp-content',
		) === true &&
		postRoot.querySelector('[data-cached-body]')?.textContent === '已缓存正文' &&
		postRoot.querySelector(
			':scope > .ldp-post-body > .ldp-content > .ldp-post-local-archive-note',
		) === null,
	'单楼层 404 必须首帧保留正文，并把轻量存档说明放在正文后的 bodyLayer',
);

state = Object.freeze({
	topic: Object.freeze({ status: 404, confirmedAt: 100 }),
	posts: Object.freeze([
		Object.freeze({ postNumber: 2, status: 410, confirmedAt: 101 }),
	]),
});
archiveChanges.emit(state);
assert(
	topicRoot.classList.contains('is-local-archive-topic') &&
		topicRoot.dataset.localArchiveStatus === '404' &&
		topicRoot.querySelector('.ldp-topic-local-archive-notice')?.textContent
			.includes('不会再按普通缓存期限自动清理') === true,
	'404 Topic 必须显示明确的永久本地存档说明',
);
assert(
	postRoot.classList.contains('is-local-archive-post') &&
	String(postRoot.dataset.localArchiveStatus) === '410' &&
	postRoot.querySelector('.ldp-post-local-archive-note')?.textContent ===
			'本地缓存 · 410 前正文 · time:101 确认（已隐藏）' &&
		postRoot.querySelector('[data-cached-body]')?.textContent === '已缓存正文',
	'失效楼层只能增加只读引用标识，不得改写或替换已缓存正文',
);

state = Object.freeze({ topic: null, posts: Object.freeze([]) });
archiveChanges.emit(state);
assert(
	!topicRoot.classList.contains('is-local-archive-topic') &&
	!postRoot.classList.contains('is-local-archive-post') &&
	postRoot.querySelector('.ldp-post-local-archive-note') === null &&
	postRoot.querySelector('.ldp-post-head .ldp-hidden-badge')?.textContent ===
		'已隐藏' &&
	postRoot.querySelector('[data-cached-body]')?.textContent === '已缓存正文',
	'权威恢复后必须只撤销存档标识，正文节点仍由原 PostView 持有',
);
feature.scope.destroy();
