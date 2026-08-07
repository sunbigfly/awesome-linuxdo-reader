import {
	discourseAuthScope,
	discoursePostIds,
	discoursePostIdStream,
	discoursePostReference,
	discoursePostNumbers,
	discourseReplyCursor,
	discourseTopicId,
	tryDiscoursePostNumber,
} from '../src/discourse/identifiers.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function assertThrows(operation: () => unknown, message: string): void {
	try {
		operation();
	} catch {
		return;
	}
	throw new Error(message);
}

assert(discourseTopicId('10') === 10, '字符串 Topic id 必须规范化为正整数');
assert(discourseAuthScope(' account:test ') === 'account:test', 'auth scope 必须去首尾空白');
assert(discourseReplyCursor(undefined) === 0, '缺省 replies after 必须是 0');
assert(tryDiscoursePostNumber(0) === null, '0 不是 Discourse 楼层号');
assert(discoursePostIds([30, 10, 30]).join(',') === '10,30', 'post.id 集合必须排序去重');
assert(discoursePostIdStream([30, 10, 30]).join(',') === '30,10', 'Topic stream 必须保序去重');
assert(discoursePostNumbers([3, 1, 3]).join(',') === '1,3', 'post_number 集合必须排序去重');

const reference = discoursePostReference({
	id: 300,
	topic_id: 10,
	post_number: 3,
	reply_to_post_number: 1,
});
assert(reference.postId === 300 && reference.postNumber === 3, '帖子 ID 与楼层号不得混同');
assert(reference.replyToPostNumber === 1, 'reply_to_post_number 必须映射到父楼层号');
assertThrows(
	() => discoursePostReference({ post_number: 3, reply_to_post_number: 3 }),
	'自回复关系必须在统一模型边界拒绝',
);
assertThrows(() => discoursePostIds([0]), '非法 post.id 必须拒绝');
