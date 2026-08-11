import {
	resolveReaderReplyAncestors,
} from '../src/topic/reader-reply-ancestor-resolver.js';
import type { DiscourseTopicPostInput } from '../src/topic/topic-session.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestPost extends DiscourseTopicPostInput {
	readonly id: number;
	readonly post_number: number;
	readonly reply_to_post_number: number | null;
}

const source = new Map<number, TestPost>([
	[84, { id: 1084, post_number: 84, reply_to_post_number: 12 }],
	[12, { id: 1012, post_number: 12, reply_to_post_number: 3 }],
	[3, { id: 1003, post_number: 3, reply_to_post_number: null }],
]);
const canonical = new Map<number, TestPost>([[84, source.get(84)!]]);
const requested: number[] = [];
const session = {
	postByNumber: (postNumber: number) => canonical.get(postNumber),
	async loadTarget(postNumber: number) {
		requested.push(postNumber);
		const post = source.get(postNumber);
		if (post) canonical.set(postNumber, post);
		return post ? [post] : [];
	},
};
const resolution = await resolveReaderReplyAncestors(session, 84);
assert(
	resolution.complete &&
		resolution.rootPostNumber === 3 &&
		requested.join(',') === '12,3' &&
		resolution.loadedPostNumbers.join(',') === '12,3',
	'高楼目标必须沿 reply_to 用同一 TopicSession 精确补齐缺失祖先，不能因 around 批次缺父楼而成为假根',
);
requested.length = 0;
const cachedResolution = await resolveReaderReplyAncestors(session, 84);
assert(
	cachedResolution.complete &&
		cachedResolution.rootPostNumber === 3 &&
		requested.length === 0,
	'回屏和重复跳转必须直接复用 canonical 祖先，不得再次发请求',
);
const directUnderOp = new Map<number, TestPost>([
	[9, { id: 1009, post_number: 9, reply_to_post_number: 1 }],
]);
const branchResolution = await resolveReaderReplyAncestors({
	postByNumber: (postNumber) => directUnderOp.get(postNumber),
	async loadTarget() {
		return [];
	},
}, 9, { stopBeforePostNumber: 1 });
assert(
	branchResolution.complete && branchResolution.rootPostNumber === 9,
	'完整讨论必须可在 OP 之前停止，把直属回复作为局部讨论根而不复制另一套遍历逻辑',
);
const orphanTarget = new Map<number, TestPost>([
	[62, { id: 1062, post_number: 62, reply_to_post_number: 41 }],
]);
const orphanResolution = await resolveReaderReplyAncestors({
	postByNumber: (postNumber) => orphanTarget.get(postNumber),
	async loadTarget() {
		return [];
	},
}, 62, { stopBeforePostNumber: 1 });
assert(
	!orphanResolution.complete && orphanResolution.rootPostNumber === 62,
	'父回复已删除或不可读时，祖先解析必须回退到最高可用楼层，不能把缺失父楼当成可打开的根',
);
let active = true;
const cancelled = await resolveReaderReplyAncestors({
	postByNumber: () => undefined,
	async loadTarget() {
		active = false;
		return [];
	},
}, 99, { isActive: () => active });
assert(
	!cancelled.complete && cancelled.rootPostNumber === 99,
	'切帖或更新目标后必须停止祖先补齐，晚到请求不能把用户拉回旧树',
);
