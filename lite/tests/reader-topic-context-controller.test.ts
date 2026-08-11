import {
	discoursePostNumber,
	discourseTopicId,
} from '../src/discourse/identifiers.js';
import { ReplyTreeRepository } from '../src/dom/reply-tree-repository.js';
import { Signal } from '../src/kernel/signal.js';
import {
	ReaderTopicContextController,
	type ReaderTopicContextSessionPort,
} from '../src/topic/reader-topic-context-controller.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestPost {
	readonly id: number;
	readonly topic_id: number;
	readonly post_number: number;
	readonly reply_to_post_number: number | null;
	readonly username: string;
	readonly cooked: string;
	readonly reply_count: number;
}

const allPosts: readonly TestPost[] = Object.freeze([
	{
		id: 101,
		topic_id: 10,
		post_number: 1,
		reply_to_post_number: null,
		username: 'op',
		cooked: '<p>root</p>',
		reply_count: 2,
	},
	{
		id: 102,
		topic_id: 10,
		post_number: 2,
		reply_to_post_number: 1,
		username: 'branch',
		cooked: '<p>branch</p>',
		reply_count: 2,
	},
	{
		id: 103,
		topic_id: 10,
		post_number: 3,
		reply_to_post_number: 2,
		username: 'child',
		cooked: '<p>child</p>',
		reply_count: 1,
	},
	{
		id: 104,
		topic_id: 10,
		post_number: 4,
		reply_to_post_number: 3,
		username: 'deep',
		cooked: '<p>deep</p>',
		reply_count: 0,
	},
	{
		id: 105,
		topic_id: 10,
		post_number: 5,
		reply_to_post_number: 1,
		username: 'sibling',
		cooked: '<p>sibling</p>',
		reply_count: 0,
	},
	{
		id: 107,
		topic_id: 10,
		post_number: 7,
		reply_to_post_number: 2,
		username: 'branch-sibling',
		cooked: '<p>branch sibling</p>',
		reply_count: 0,
	},
]);

class TestSession implements ReaderTopicContextSessionPort<TestPost> {
	readonly topicId = discourseTopicId(10);
	readonly changes = new Signal<unknown>();
	readonly loaded = new Map<number, TestPost>();
	loadTargetCalls = 0;
	ensureCalls = 0;
	readonly directReplyCalls: number[] = [];
	readonly replyBranchCalls: number[][] = [];
	ensureBackgrounds: boolean[] = [];
	loadTargetGate: Promise<void> | null = null;
	ensureGate: Promise<void> | null = null;

	constructor(initial: readonly TestPost[]) {
		for (const post of initial) this.loaded.set(post.post_number, post);
	}

	cachedPosts(): readonly TestPost[] {
		return [...this.loaded.values()]
			.sort((left, right) => left.post_number - right.post_number);
	}

	postByNumber(postNumber: number): TestPost | undefined {
		return this.loaded.get(postNumber);
	}

	postStreamCoverage() {
		return {
			complete: this.loaded.size === allPosts.length,
			expectedPostCount: allPosts.length,
			streamPostCount: allPosts.length,
			missingPostCount: allPosts.length - this.loaded.size,
		};
	}

	async loadTarget(postNumber: number): Promise<readonly TestPost[]> {
		this.loadTargetCalls += 1;
		if (this.loadTargetGate) await this.loadTargetGate;
		const post = allPosts.find((candidate) =>
			candidate.post_number === postNumber
		);
		if (!post) return [];
		this.loaded.set(post.post_number, post);
		replies.ingest([post], 'target-refresh', {
			observedAt: this.loadTargetCalls + 1,
		});
		this.changes.emit({ source: 'target-refresh' });
		return [post];
	}

	async ensurePostStream(options: { background?: boolean } = {}) {
		this.ensureCalls += 1;
		this.ensureBackgrounds.push(options.background === true);
		await this.ensureGate;
		for (const post of allPosts) this.loaded.set(post.post_number, post);
		replies.setExpectedPostCount(allPosts.length);
		replies.ingest(allPosts, 'loader-batch', {
			observedAt: 100 + this.ensureCalls,
		});
		this.changes.emit({ source: 'loader-batch' });
		return { complete: true, failedBatchCount: 0 };
	}

	async loadDirectReplies(postNumber: number) {
		this.directReplyCalls.push(postNumber);
		const direct = allPosts.filter((post) =>
			post.reply_to_post_number === postNumber);
		for (const post of direct) this.loaded.set(post.post_number, post);
		replies.ingest(direct, 'loader-batch', {
			observedAt: 300 + this.directReplyCalls.length,
		});
		this.changes.emit({ source: 'loader-batch' });
		return Object.freeze({
			parentPostNumber: discoursePostNumber(postNumber),
			posts: Object.freeze(direct),
			scopedPosts: Object.freeze(direct),
			expectedCount: direct.length,
			complete: true,
			endpointExhausted: true,
			pageCount: 1,
			nextAfter: direct.at(-1)?.post_number ?? 0,
		});
	}

	async loadReplyBranches(rootPostNumbers: readonly number[]) {
		const roots = rootPostNumbers.map(discoursePostNumber);
		this.replyBranchCalls.push(roots);
		const pending = [...roots];
		const seen = new Set<number>();
		const parents: number[] = [];
		let expectedReplyCount = 0;
		let loadedReplyCount = 0;
		for (let index = 0; index < pending.length; index += 1) {
			const postNumber = pending[index]!;
			if (seen.has(postNumber)) continue;
			seen.add(postNumber);
			const post = this.loaded.get(postNumber);
			if (!post) continue;
			let children = replies.topology.childrenOf(postNumber);
			const expected = Math.max(post.reply_count, children.length);
			if (expected > 0) {
				parents.push(postNumber);
				const loaded = children.filter((child) => this.loaded.has(child));
				if (loaded.length < expected) await this.loadDirectReplies(postNumber);
				children = replies.topology.childrenOf(postNumber);
				expectedReplyCount += expected;
				loadedReplyCount += children.filter((child) =>
					this.loaded.has(child)).length;
			}
			pending.push(...children.map(discoursePostNumber));
		}
		return Object.freeze({
			rootPostNumbers: Object.freeze(roots),
			postNumbers: Object.freeze([...seen].map(discoursePostNumber)),
			parentPostNumbers: Object.freeze(parents.map(discoursePostNumber)),
			expectedReplyCount,
			loadedReplyCount,
			complete: loadedReplyCount >= expectedReplyCount,
			contextualReplyRelations: Object.freeze([]),
			errors: Object.freeze([]),
		});
	}

	ingestLive(post: TestPost): void {
		this.loaded.set(post.post_number, post);
		replies.setExpectedPostCount(this.loaded.size);
		replies.ingest([post], 'message-bus', { observedAt: 500 });
		this.changes.emit({ source: 'message-bus' });
	}
}

const replies = new ReplyTreeRepository(10, {
	async load() {
		return null;
	},
	async save() {},
});
replies.setExpectedPostCount(allPosts.length);
replies.ingest(allPosts.slice(0, 2), 'topic-json', { observedAt: 1 });
const session = new TestSession(allPosts.slice(0, 2));
const errors: unknown[] = [];
let crossTopicQuoteLoads = 0;
const crossTopicPost: TestPost = Object.freeze({
	id: 203,
	topic_id: 11,
	post_number: 3,
	reply_to_post_number: null,
	username: 'cross-topic',
	cooked: '<p>cross topic</p>',
	reply_count: 0,
});
const controller = new ReaderTopicContextController({
	session,
	replies,
	loadCrossTopicQuotedPost: async (topicId, postNumber) => {
		crossTopicQuoteLoads += 1;
		return Number(topicId) === 11 && Number(postNumber) === 3
			? crossTopicPost
			: null;
	},
	onError: (error) => errors.push(error),
});

const deepDiscussion = await controller.openDiscussion(4);
assert(
	deepDiscussion.discussion?.rootPostNumber === 2 &&
	deepDiscussion.discussion.targetPostNumber === 4 &&
	deepDiscussion.discussion.entries
		.map((entry) => `${entry.postNumber}:${entry.parentPostNumber}:${entry.depth}`)
		.join(',') === '2:null:0,3:2:1,7:2:1,4:3:2' &&
	deepDiscussion.discussion.entries.length === 4 &&
	!deepDiscussion.discussion.partial &&
	session.ensureCalls === 0 &&
	session.directReplyCalls.join(',') === '2',
	'深层目标必须沿 canonical 拓扑找根，并只用父级 endpoint 补当前完整子树而非遍历全帖',
);
assert(
	!deepDiscussion.discussion.entries.some((entry) => entry.postNumber === 5),
	'完整讨论不得把同级根分支混入当前子树',
);

const lineageBranchDiscussion = await controller.openDiscussion(3, {
	descendantRootPostNumber: 3,
});
assert(
	lineageBranchDiscussion.discussion?.rootPostNumber === 2 &&
	lineageBranchDiscussion.discussion.descendantRootPostNumber === 3 &&
	lineageBranchDiscussion.discussion.entries
		.map((entry) => `${entry.postNumber}:${entry.parentPostNumber}:${entry.depth}`)
		.join(',') === '2:null:0,3:2:1,4:3:2' &&
	!lineageBranchDiscussion.discussion.entries.some((entry) =>
		entry.postNumber === 7) &&
	session.replyBranchCalls.map((call) => call.join(',')).join('|') === '2|3',
	'完整分支必须向上只保留单线祖先、从当前节点向下展开全部后代，并只加载当前分支而非祖先旁支',
);

controller.toggleDiscussionBranch(3);
assert(
	controller.snapshot().discussion?.collapsedPostNumbers.join(',') === '3',
	'逐支收纳只能保存 surface UI 状态，不得改写 canonical ReplyTree',
);
assert(
	replies.topology.parentOf(4) === 3,
	'逐支收纳后 canonical 父子关系必须保持不变',
);

let latest = controller.snapshot();
controller.changes.subscribe((snapshot) => {
	latest = snapshot;
});
const livePost: TestPost = {
	id: 106,
	topic_id: 10,
	post_number: 6,
	reply_to_post_number: 4,
	username: 'live',
	cooked: '<p>live</p>',
	reply_count: 0,
};
session.ingestLive(livePost);
assert(
	latest.discussion?.entries.at(-1)?.postNumber === 6 &&
	latest.discussion.entries.at(-1)?.depth === 3,
	'MessageBus 经 TopicSession/ReplyTree 提交后必须实时更新同一个讨论投影',
);

const restored = await controller.openDiscussion(2, {
	explicitRoot: true,
	targetPostNumber: null,
});
assert(
	restored.discussion?.rootPostNumber === 2 &&
	restored.discussion.targetPostNumber === null &&
	restored.discussion.entries.length === 5,
	'历史恢复的权威讨论根不得重新推导或维护第二套分支栈',
);

const canonicalLoadReplyBranches = session.loadReplyBranches.bind(session);
const contextualPost = allPosts.find((post) => post.post_number === 5)!;
session.loaded.set(contextualPost.post_number, contextualPost);
replies.ingest([contextualPost], 'loader-batch', { observedAt: 600 });
Object.defineProperty(session, 'loadReplyBranches', {
	value: async (rootPostNumbers: readonly number[]) => {
		const result = await canonicalLoadReplyBranches(rootPostNumbers);
		return Object.freeze({
			...result,
			contextualReplyRelations: Object.freeze([Object.freeze({
				parentPostNumber: discoursePostNumber(2),
				postNumber: discoursePostNumber(5),
			})]),
		});
	},
	configurable: true,
});
const contextualDiscussion = await controller.openDiscussion(2, {
	explicitRoot: true,
	targetPostNumber: null,
});
const contextualEntry = contextualDiscussion.discussion?.entries.find((entry) =>
	entry.postNumber === 5);
assert(
	contextualEntry?.parentPostNumber === 2 &&
		contextualEntry.depth === 1 &&
		replies.topology.parentOf(5) === 1 &&
		!contextualDiscussion.discussion?.partial,
	'完整讨论必须投影 endpoint 的上下文关系，同时保持 canonical reply_to 父级不变',
);
Object.defineProperty(session, 'loadReplyBranches', {
	value: canonicalLoadReplyBranches,
	configurable: true,
});

const quoted = await controller.loadQuotedPost(10, 3);
const crossTopicQuoted = await controller.loadQuotedPost(11, 3);
const cachedCrossTopicQuoted = await controller.loadQuotedPost(11, 3);
const missingCrossTopicQuoted = await controller.loadQuotedPost(12, 4);
const cachedMissingCrossTopicQuoted = await controller.loadQuotedPost(12, 4);
assert(
	quoted?.post_number === 3 &&
	crossTopicQuoted?.topic_id === 11 &&
	cachedCrossTopicQuoted === crossTopicQuoted &&
	missingCrossTopicQuoted === null &&
	cachedMissingCrossTopicQuoted === null &&
	crossTopicQuoteLoads === 2,
	'同 Topic 引用必须复用 TopicSession；跨 Topic 引用的正文与明确缺失结果都只能在当前上下文会话加载一次',
);

let releaseDiscussion!: () => void;
Object.defineProperty(session, 'loadReplyBranches', {
	value: undefined,
	configurable: true,
});
session.ensureGate = new Promise<void>((resolve) => {
	releaseDiscussion = resolve;
});
const pendingDiscussion = controller.openDiscussion(4);
await Promise.resolve();
await Promise.resolve();
releaseDiscussion();
await pendingDiscussion;
assert(
	controller.snapshot().discussion?.loading === false,
	'完整讨论补全必须在统一取消域内完成，不能遗留 loading 状态',
);
session.ensureGate = null;
controller.closeDiscussion();
assert(
	controller.snapshot().discussion === null &&
	replies.topology.parentOf(6) === 4 &&
	errors.length === 0,
	'关闭 surface 只能释放选择状态，不能清空 canonical 树或帖子',
);
session.loaded.delete(4);
let releaseTarget!: () => void;
session.loadTargetGate = new Promise<void>((resolve) => {
	releaseTarget = resolve;
});
const closingLoad = controller.openDiscussion(4);
await Promise.resolve();
controller.closeDiscussion();
releaseTarget();
await closingLoad;
assert(
	controller.snapshot().discussion === null,
	'讨论根仍在补齐时关闭必须取消该 epoch，晚到目标不得重新打开 surface',
);
session.loaded.delete(5);
let releaseQuote!: () => void;
session.loadTargetGate = new Promise<void>((resolve) => {
	releaseQuote = resolve;
});
const lateQuote = controller.loadQuotedPost(10, 5);
await Promise.resolve();
controller.destroy();
releaseQuote();
assert(
	await lateQuote === null && errors.length === 0,
	'Topic owner 销毁后的晚到引用补齐必须静默丢弃，不能污染下一 Topic 的诊断',
);

const orphanPost: TestPost = Object.freeze({
	id: 1062,
	topic_id: 62,
	post_number: 62,
	reply_to_post_number: 41,
	username: 'op',
	cooked: '<p>orphan reply</p>',
	reply_count: 0,
});
const orphanReplies = new ReplyTreeRepository(62, {
	async load() {
		return null;
	},
	async save() {},
});
orphanReplies.setExpectedPostCount(1);
orphanReplies.ingest([orphanPost], 'topic-json', { observedAt: 1 });
const orphanChanges = new Signal<unknown>();
const orphanErrors: unknown[] = [];
const orphanController = new ReaderTopicContextController({
	session: {
		topicId: discourseTopicId(62),
		changes: orphanChanges,
		cachedPosts: () => Object.freeze([orphanPost]),
		postByNumber: (postNumber) =>
			postNumber === orphanPost.post_number ? orphanPost : undefined,
		postStreamCoverage: () => ({
			complete: true,
			expectedPostCount: 1,
			streamPostCount: 1,
			missingPostCount: 0,
		}),
		async loadTarget() {
			throw new Error('父楼不可读');
		},
		async ensurePostStream() {
			return Object.freeze({ complete: true, failedBatchCount: 0 });
		},
	},
	replies: orphanReplies,
	onError: (error) => orphanErrors.push(error),
});
const orphanDiscussion = await orphanController.openDiscussion(62);
assert(
	orphanDiscussion.discussion?.rootPostNumber === 62 &&
		orphanDiscussion.discussion.targetPostNumber === 62 &&
		orphanDiscussion.discussion.entries
			.map((entry) => entry.postNumber).join(',') === '62' &&
		orphanDiscussion.discussion.partial &&
		orphanErrors.length === 1,
	'父回复已删除、不可读或补载报错时，完整讨论入口仍必须打开可用子树，并标记为不完整',
);
orphanController.destroy();
