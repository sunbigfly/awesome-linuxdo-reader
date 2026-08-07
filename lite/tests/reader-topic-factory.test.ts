import { parseHTML } from 'linkedom';
import { Signal } from '../src/kernel/signal.js';
import { ReplyTreeRepository } from '../src/dom/reply-tree-repository.js';
import { ReaderShell } from '../src/shell/reader-shell.js';
import {
	createReaderTopicFactory,
} from '../src/topic/reader-topic-factory.js';
import type {
	TopicSessionCommit,
} from '../src/topic/topic-session.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestPost {
	readonly id: number;
	readonly post_number: number;
	readonly reply_to_post_number: number | null;
	readonly username: string;
	readonly cooked: string;
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body><div class="root"><div class="modal">' +
	'<header></header><main class="body"><div class="topic-host"></div></main>' +
	'<div class="surfaces"></div></div></div></body></html>',
);
const document = parsedDocument as unknown as Document;
const root = document.querySelector<HTMLElement>('.root')!;
const shell = new ReaderShell('reader:v1', {
	root,
	modal: document.querySelector<HTMLElement>('.modal')!,
	body: document.querySelector<HTMLElement>('.body')!,
	topicHost: document.querySelector<HTMLElement>('.topic-host')!,
	surfaceHost: document.querySelector<HTMLElement>('.surfaces')!,
});
let cleanupCount = 0;
let readyCleanupCount = 0;
let assembledCleanupCount = 0;
let activationCount = 0;
let activationCleanupCount = 0;
const lifecycleOrder: string[] = [];
const topicSignals = new Map<number, AbortSignal>();

const factory = createReaderTopicFactory({
	document,
	createBundle(context) {
		topicSignals.set(Number(context.topicId), context.signal);
		const post: TestPost = Object.freeze({
			id: Number(context.topicId) * 10 + 1,
			post_number: 1,
			reply_to_post_number: null,
			username: `topic-${context.topicId}`,
			cooked: `content-${context.topicId}`,
		});
		const changes = new Signal<TopicSessionCommit>();
		const replies = new ReplyTreeRepository(context.topicId, {
			async load() {
				return null;
			},
			async save() {},
		});
		const session = {
			changes,
			async init() {
				lifecycleOrder.push(`init:${context.topicId}`);
				replies.ingest([post], 'topic-json');
				changes.emit(Object.freeze({
					source: 'topic-json' as const,
					observedAt: Number(context.topicId),
					acceptedPosts: 1,
					ignoredPosts: 0,
					changedPostNumbers: Object.freeze([1]),
					topicChanged: true,
					streamChanged: true,
				}));
				return Object.freeze({ id: Number(context.topicId) });
			},
			cachedPosts: () => Object.freeze([post]),
			postByNumber: (postNumber: number) => postNumber === 1 ? post : undefined,
			async next() {
				return Object.freeze({
					posts: Object.freeze([]),
					done: true,
					retry: false,
					fatal: false,
					missingPostIds: Object.freeze([]),
				});
			},
		};
		return {
			session,
			replies,
			services: Object.freeze({ topicId: context.topicId }),
			activate() {
				activationCount += 1;
				lifecycleOrder.push(`activate:${context.topicId}`);
				return () => {
					activationCleanupCount += 1;
				};
			},
			cleanup: () => {
				cleanupCount += 1;
			},
		};
	},
	createDomOptions: () => ({
		estimatedRootSize: 300,
		scroll: {
			readWindowInput: () => ({
				scrollOffset: 0,
				viewportSize: 800,
			}),
			applyScrollCompensation() {},
			listenScroll() {
				return () => {};
			},
			writeScrollOffset() {},
			alignPost() {},
		},
		identity: (post: TestPost) => ({
			postId: post.id,
			postNumber: post.post_number,
			username: post.username,
		}),
		render(post: TestPost, view) {
			view.slots.content.textContent = post.cooked;
		},
		observerFactory: () => ({
			observe() {},
			unobserve() {},
			disconnect() {},
		}),
		frameScheduler: {
			request: () => 1,
			cancel() {},
		},
	}),
	onAssembled(value, context) {
		assert(
			value.dom.domOwner.view(1)?.slots.root.isConnected,
			'onAssembled 前必须已完成 canonical 首帧 DOM',
		);
		lifecycleOrder.push(`assembled:${context.topicId}`);
		return () => {
			assembledCleanupCount += 1;
		};
	},
	onReady() {
		return () => {
			readyCleanupCount += 1;
		};
	},
});

const opened = await shell.open(10, factory);
assert(opened.status === 'opened', 'Topic factory 必须提交第一个 context');
assert(
	root.querySelector('[data-topic-id="10"] [data-post-number="1"] .ldp-content')
		?.textContent === 'content-10',
	'Topic factory 必须把 canonical session 数据装入唯一 Topic root',
);
assert(
	lifecycleOrder.join(',') === 'init:10,assembled:10,activate:10',
	'Topic factory 必须先完成 Topic/树/DOM 与跨域 owner 连接，再 activate 实时输入',
);
const switched = await shell.open(11, factory);
assert(switched.status === 'opened', 'Topic factory 必须支持 Shell 内切帖');
assert(topicSignals.get(10)?.aborted === true, '切帖必须 abort 旧 Topic 的全部请求信号');
assert(topicSignals.get(11)?.aborted === false, '新 Topic 请求信号不能被旧 Topic 污染');
assert(!root.querySelector('[data-topic-id="10"]'), '切帖必须移除旧 Topic root');
assert(root.querySelector('[data-topic-id="11"]'), '切帖必须只保留新 Topic root');
assert(
	cleanupCount === 1 &&
	readyCleanupCount === 1 &&
	assembledCleanupCount === 1,
	'切帖必须反向释放旧 bundle、assembled owner 与 ready consumer',
);
assert(
	activationCount === 2 && activationCleanupCount === 1,
	'切帖必须启动新 Topic 并释放旧 Topic activation',
);

shell.destroy();
assert(topicSignals.get(11)?.aborted === true, 'Shell destroy 必须 abort 当前 Topic 请求信号');
assert(
	Number(cleanupCount) === 2 && Number(readyCleanupCount) === 2,
	'Shell destroy 必须释放当前 Topic factory',
);
assert(
	Number(assembledCleanupCount) === 2,
	'Shell destroy 必须释放当前 Topic assembled owner',
);
assert(
	Number(activationCleanupCount) === 2,
	'Shell destroy 必须释放当前 Topic activation',
);
