import {
	ReaderShareActionCoordinator,
	type ReaderShareSurfacePort,
} from '../src/post/reader-share-action-coordinator.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const linkCalls: Array<readonly [number, number]> = [];
const copied: string[] = [];
const shared: Array<Readonly<{ readonly title: string; readonly url: string }>> = [];
let shareOutcome: Awaited<ReturnType<ReaderShareSurfacePort['share']>> =
	'shared';
let shareFailure = false;
let copyWait: Promise<void> | null = null;
const surface: ReaderShareSurfacePort = {
	async share(input) {
		shared.push(input);
		if (shareFailure) throw new Error('native share failed');
		return shareOutcome;
	},
	async copyText(text) {
		copied.push(text);
		if (copyWait) await copyWait;
	},
};
const coordinator = new ReaderShareActionCoordinator({
	topicId: 42,
	topic: () => ({ id: 42, title: '统一分享' }),
	links: {
		topicHref(topicId, postNumber = 0) {
			linkCalls.push([topicId, postNumber]);
			return `https://linux.do/t/${topicId}${
				postNumber ? `/${postNumber}` : ''
			}`;
		},
	},
	surface,
	fallbackTitle: () => 'fallback',
});

const postResult = await coordinator.sharePost({ post_number: 7 });
assert(
	postResult.target === 'post' &&
	postResult.outcome === 'copied' &&
	postResult.postNumber === 7 &&
	copied[0] === 'https://linux.do/t/42/7' &&
	linkCalls[0]?.[0] === 42 &&
	linkCalls[0]?.[1] === 7,
	'楼层分享必须只复制 Discourse 原生端口生成的精确楼层链接',
);

const topicResult = await coordinator.shareTopic({ post_number: 1 });
assert(
	topicResult.target === 'topic' &&
	topicResult.outcome === 'shared' &&
	shared.at(-1)?.title === '统一分享' &&
	shared.at(-1)?.url === 'https://linux.do/t/42' &&
	copied.length === 1,
	'主题分享成功必须使用 canonical 标题与无楼层链接，且不能再写剪贴板',
);

shareOutcome = 'cancelled';
const cancelled = await coordinator.shareTopic({ post_number: 1 });
assert(
	cancelled.outcome === 'cancelled' && copied.length === 1,
	'用户取消 Web Share 必须静默结束，不能误回退剪贴板',
);

shareOutcome = 'unsupported';
const unsupported = await coordinator.shareTopic({ post_number: 1 });
assert(
	unsupported.outcome === 'copied' &&
	copied.at(-1) === 'https://linux.do/t/42',
	'浏览器不支持 Web Share 时必须回退复制主题链接',
);

shareFailure = true;
const failedNative = await coordinator.shareTopic({ post_number: 1 });
assert(
	failedNative.outcome === 'copied' &&
	copied.at(-1) === 'https://linux.do/t/42',
	'Web Share 非取消错误必须保持旧版语义并回退剪贴板',
);

let releaseCopy = (): void => {};
copyWait = new Promise<void>((resolve) => {
	releaseCopy = resolve;
});
const first = coordinator.sharePost({ post_number: 9 });
const second = coordinator.sharePost({ post_number: 9 });
assert(first === second, '同一主题同一楼层的并发复制必须 single-flight');
releaseCopy();
copyWait = null;
await first;

let missingRejected = false;
try {
	await new ReaderShareActionCoordinator({
		topicId: 42,
		topic: () => ({ title: '' }),
		links: { topicHref: () => '' },
		surface,
		fallbackTitle: () => '',
	}).sharePost({ post_number: 3 });
} catch (cause) {
	missingRejected = cause instanceof Error &&
		cause.message.includes('楼层 #3');
}
assert(
	missingRejected,
	'原生 URL helper 不可用时必须显式失败，不能手写近似 Topic 路径',
);
