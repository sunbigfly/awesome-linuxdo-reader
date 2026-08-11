import {
	ReaderTopicNavigationController,
	type ReaderTopicNavigationRequest,
} from '../src/topic/reader-topic-navigation-controller.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestPost {
	readonly id: number;
	readonly topic_id: number;
	readonly post_number: number;
	readonly reply_to_post_number: number | null;
}

function post(postNumber: number): TestPost {
	return Object.freeze({
		id: 100 + postNumber,
		topic_id: 10,
		post_number: postNumber,
		reply_to_post_number: postNumber === 1 ? null : 1,
	});
}

const posts = new Map<number, TestPost>([[1, post(1)]]);
const loads: Array<Readonly<{
	postNumber: number;
	scope: string | undefined;
	forceRefresh: boolean | undefined;
}>> = [];
const reveals: Array<Readonly<{
	postNumber: number;
	source: string;
	alignment: string | undefined;
	degradedRootPostNumber: number | undefined;
}>> = [];
const hiddenReveals: number[] = [];
const hiddenPostNumbers = new Set<number>([6]);
const delayed = {
	resolve: undefined as (() => void) | undefined,
	reject: undefined as ((error: unknown) => void) | undefined,
};
const errors: unknown[] = [];
const missingAncestorError = new Error('ancestor unavailable');
const userScrollIntent = {
	value: null as (() => void) | null,
};
const navigation = new ReaderTopicNavigationController<TestPost>({
	session: {
		postByNumber(postNumber) {
			return posts.get(postNumber);
		},
		async loadTarget(postNumber, options) {
			loads.push({
				postNumber,
				scope: options?.scope,
				forceRefresh: options?.forceRefresh,
			});
			if (postNumber === 8 || postNumber === 10) {
				await new Promise<void>((resolve) => {
					delayed.resolve = resolve;
				});
			}
			if (postNumber === 9) {
				await new Promise<void>((_resolve, reject) => {
					delayed.reject = reject;
				});
			}
			if (postNumber === 70) throw missingAncestorError;
			if (postNumber !== 404 && postNumber !== 41) {
				posts.set(postNumber, post(postNumber));
			}
			return posts.has(postNumber)
				? Object.freeze([posts.get(postNumber)!])
				: Object.freeze([]);
		},
	},
	dom: {
		revealPost(postNumber, options) {
			reveals.push({
				postNumber,
				source: options.source,
				alignment: options.alignment,
				degradedRootPostNumber: options.degradedRootPostNumber,
			});
			if (postNumber === 7) return null;
			return Object.freeze({
				postNumber,
				rootPostNumber: postNumber === 1 ? 1 : 1,
				element: {} as HTMLElement,
				mounted: postNumber !== 1,
			});
		},
	},
	hidden: {
		isHidden: (postNumber) => hiddenPostNumbers.has(postNumber),
		async revealPost(postNumber) {
			hiddenReveals.push(postNumber);
			return Object.freeze({
				postNumber,
				rootPostNumber: 1,
				element: { dataset: { postNumber: String(postNumber) } } as
					unknown as HTMLElement,
				mounted: true,
			});
		},
	},
	listenUserScrollIntent(listener) {
		userScrollIntent.value = listener;
		return () => {
			if (userScrollIntent.value === listener) userScrollIntent.value = null;
		};
	},
	onError: (error) => errors.push(error),
});
const changes: string[] = [];
navigation.changes.subscribe((result) => {
	changes.push(`${result.postNumber}:${result.status}`);
});

const existing = await navigation.navigate({
	postNumber: 1,
	source: 'timeline',
	alignment: 'center',
});
assert(
	existing.status === 'revealed' &&
	loads.length === 0 &&
	reveals.at(-1)?.source === 'timeline',
	'已缓存楼层必须直接进入唯一 reveal 端口，不重复请求',
);

const loaded = await navigation.navigate({
	postNumber: 5,
	source: 'history',
	alignment: 'nearest',
	highlight: true,
});
assert(
	loaded.status === 'revealed' &&
	loaded.mounted &&
	loads.at(-1)?.postNumber === 5 &&
	loads.at(-1)?.scope === 'around',
	'缺失目标必须先经 TopicSession around 补流，再揭示 canonical 树节点',
);

const hidden = await navigation.navigate({
	postNumber: 6,
	source: 'quote',
	highlight: true,
});
assert(
	hidden.status === 'revealed' &&
		hidden.element?.dataset.postNumber === '6' &&
		hiddenReveals.join(',') === '6' &&
		!reveals.some((entry) => entry.postNumber === 6),
	'主投影隐藏的目标必须只在完整讨论端口揭示，不能再交给正文 DOM 提升成正式楼层',
);

const unavailable = await navigation.navigate({
	postNumber: 404,
	source: 'message',
});
assert(
	unavailable.status === 'unavailable' &&
	!reveals.some((entry) => entry.postNumber === 404),
	'权威补流仍无目标时不得猜楼层或写 DOM',
);

posts.set(7, post(7));
const unresolved = await navigation.navigate({
	postNumber: 7,
	source: 'lightbox',
});
assert(
	unresolved.status === 'unresolved-tree',
	'正文存在但拓扑/DOM 未形成时必须保持 unresolved，不能降级成根楼层',
);

posts.set(62, Object.freeze({
	id: 162,
	topic_id: 10,
	post_number: 62,
	reply_to_post_number: 41,
}));
posts.set(63, Object.freeze({
	id: 163,
	topic_id: 10,
	post_number: 63,
	reply_to_post_number: 62,
}));
posts.set(64, Object.freeze({
	id: 164,
	topic_id: 10,
	post_number: 64,
	reply_to_post_number: 63,
}));
const degradedMissingAncestor = await navigation.navigate({
	postNumber: 64,
	source: 'quote',
});
assert(
	degradedMissingAncestor.status === 'revealed' &&
	reveals.at(-1)?.postNumber === 64 &&
	reveals.at(-1)?.degradedRootPostNumber === 62,
	'祖先楼层不存在时必须把最高可用祖先交给 DOM 投影降级，不能丢掉其下已确认链条',
);
posts.set(71, Object.freeze({
	id: 171,
	topic_id: 10,
	post_number: 71,
	reply_to_post_number: 70,
}));
const degradedFailedAncestor = await navigation.navigate({
	postNumber: 71,
	source: 'quote',
});
assert(
	degradedFailedAncestor.status === 'revealed' &&
	reveals.at(-1)?.degradedRootPostNumber === 71 &&
	errors.includes(missingAncestorError),
	'祖先补载报错时必须记录诊断并降级到最高可用楼层，不能让目标导航整体失败',
);

const slowRequest: ReaderTopicNavigationRequest = {
	postNumber: 8,
	source: 'notification',
};
const slow = navigation.navigate(slowRequest);
await Promise.resolve();
const resolveSlow = delayed.resolve;
assert(resolveSlow !== undefined, '慢目标必须进入可控 loadTarget');
const latest = await navigation.navigate({
	postNumber: 1,
	source: 'composer',
	focus: true,
});
resolveSlow();
const superseded = await slow;
assert(
	latest.status === 'revealed' &&
	superseded.status === 'superseded' &&
	!reveals.some((entry) => entry.postNumber === 8),
	'较晚导航必须取代慢响应，旧目标不得把视口拉回',
);
const userCancelled = navigation.navigate({
	postNumber: 10,
	source: 'timeline',
});
await Promise.resolve();
const resolveUserCancelled = delayed.resolve;
assert(
	resolveUserCancelled !== undefined && userScrollIntent.value !== null,
	'慢楼层导航必须连接统一用户滚动意图端口',
);
const revisionBeforeUserScroll = navigation.revision;
userScrollIntent.value();
assert(
	!navigation.isCurrent(revisionBeforeUserScroll),
	'用户滚动意图必须立即取代未完成的程序化导航事务',
);
resolveUserCancelled();
const userCancelledResult = await userCancelled;
assert(
	userCancelledResult.status === 'superseded' &&
		!reveals.some((entry) => entry.postNumber === 10),
	'用户已继续滚动时，晚到的目标楼层不得再把视口拉回',
);
assert(
	changes.includes('404:unavailable') &&
	changes.includes('7:unresolved-tree') &&
	!changes.includes('8:superseded'),
	'superseded 只返回给调用方，不应污染当前导航状态',
);

const staleFailure = new Error('stale target failed');
const failedSlow = navigation.navigate({
	postNumber: 9,
	source: 'notification',
});
await Promise.resolve();
const rejectSlow = delayed.reject;
assert(rejectSlow !== undefined, '失败慢目标必须进入可控 loadTarget');
await navigation.navigate({ postNumber: 1, source: 'link' });
rejectSlow(staleFailure);
let failedSlowResult: Awaited<typeof failedSlow> | null = null;
let failedSlowRejected = false;
try {
	failedSlowResult = await failedSlow;
} catch {
	failedSlowRejected = true;
}
assert(
	!failedSlowRejected &&
	failedSlowResult?.status === 'superseded' &&
	!errors.includes(staleFailure),
	'被新导航取代的旧请求即使晚到失败，也必须静默 superseded 而不是污染当前诊断',
);

const listenerFailure = new Error('navigation listener failed');
navigation.changes.subscribe(() => {
	throw listenerFailure;
});
await navigation.navigate({ postNumber: 1, source: 'timeline' });
assert(
	errors.includes(listenerFailure),
	'navigation change listener 异常必须进入具名 onError，不能静默吞掉',
);

navigation.destroy();
let destroyedRejected = false;
try {
	await navigation.navigate({ postNumber: 1, source: 'link' });
} catch {
	destroyedRejected = true;
}
assert(destroyedRejected, 'Topic scope 销毁后必须拒绝新的导航事务');
