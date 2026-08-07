import { ReplyTreeTopology } from '../src/dom/reply-tree.js';
import { Signal } from '../src/kernel/signal.js';
import {
	ReaderReplyTreePresentation,
} from '../src/topic/reader-reply-tree-preferences.js';
import {
	ReaderTopicOnlyOpController,
} from '../src/topic/reader-topic-only-op-controller.js';
import type {
	DiscourseTopicPostInput,
	TopicSessionCommit,
} from '../src/topic/topic-session.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestPost extends DiscourseTopicPostInput {
	readonly id: number;
	readonly post_number: number;
	readonly username: string;
}

const topology = new ReplyTreeTopology();
topology.commit([
	{ postNumber: 1, parentPostNumber: null },
	{ postNumber: 2, parentPostNumber: 1 },
]);
const presentation = new ReaderReplyTreePresentation(topology, {
	expandNestedRepliesByDefault: true,
	expandLeafNestedReplies: false,
	aggregateDescendantReplies: true,
	inlineReplyTreeMaxDepth: 5,
	hideNestedReplyFloors: true,
});
const changes = new Signal<TopicSessionCommit>();
let posts: readonly TestPost[] = Object.freeze([
	Object.freeze({ id: 1, post_number: 1, username: 'owner' }),
	Object.freeze({ id: 2, post_number: 2, username: 'member' }),
]);
const session = {
	topic: {
		_opUsername: '',
		posts_count: 4,
		details: { created_by: { username: 'owner' } },
	},
	changes,
	get loadDone() {
		return posts.length === 4;
	},
	cachedPosts: () => posts,
	postByNumber: (postNumber: number) =>
		posts.find((post) => post.post_number === postNumber),
};
const projectionResets: boolean[] = [];
const projectionPriority: boolean[] = [];
const controller = new ReaderTopicOnlyOpController({
	session,
	presentation,
	onProjectionChanged: (resetScroll) => projectionResets.push(resetScroll),
	onEnabledChanged: (enabled) => projectionPriority.push(enabled),
});
assert(
	controller.snapshot.available &&
	controller.snapshot.loadedPostCount === 2 &&
	controller.snapshot.totalPostCount === 4 &&
	controller.snapshot.ownerPostCount === 1 &&
	!controller.snapshot.complete,
	'只看楼主状态必须从 canonical Topic/Post 计算可用性与加载进度',
);
assert(
	controller.toggle() &&
	controller.snapshot.enabled &&
	JSON.stringify(presentation.roots()) === '[1]' &&
	JSON.stringify(projectionResets) === '[true]' &&
	JSON.stringify(projectionPriority) === '[true]',
	'开启只看楼主必须替换唯一树投影并提升 canonical Flow，不能建立第二个请求 cursor',
);

posts = Object.freeze([
	...posts,
	Object.freeze({ id: 3, post_number: 3, username: 'owner' }),
	Object.freeze({ id: 4, post_number: 4, username: 'member' }),
]);
topology.commit([
	{ postNumber: 3, parentPostNumber: 2 },
	{ postNumber: 4, parentPostNumber: null },
]);
changes.emit(Object.freeze({
	source: 'message-bus',
	observedAt: 2,
	acceptedPosts: 2,
	ignoredPosts: 0,
	changedPostNumbers: Object.freeze([3, 4]),
	topicChanged: true,
	streamChanged: true,
}));
assert(
	controller.snapshot.complete &&
	Number(controller.snapshot.ownerPostCount) === 2 &&
	JSON.stringify(presentation.roots()) === '[1,3]' &&
	JSON.stringify(projectionResets) === '[true,false]' &&
	presentation.revealAsFloor(4) &&
	presentation.rootOf(4) === 4 &&
	presentation.revealAsFloor(2) &&
	presentation.rootOf(2) === 2 &&
	presentation.rootOf(4) === undefined,
	'实时新增必须自动进入同一过滤投影，显式目标非楼主楼层仍可临时揭示',
);
assert(
	controller.toggle() &&
	!controller.snapshot.enabled &&
	JSON.stringify(presentation.roots()) === '[1,4]' &&
	JSON.stringify(projectionResets) === '[true,false,true]' &&
	JSON.stringify(projectionPriority) === '[true,false]',
	'关闭只看楼主必须恢复原 canonical 树且清除临时过滤揭示',
);
controller.destroy();
