import { RepeatActionGate } from '../src/kernel/repeat-action-gate.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

let now = 1_000;
const gate = new RepeatActionGate({
	windowMs: 100,
	now: () => now,
});
assert(
	!gate.confirm('reader:close') &&
		gate.confirm('reader:close'),
	'同一动作必须在期限内第二次触发才放行',
);
assert(
	!gate.confirm('reader:close') &&
		!gate.confirm('composer:close'),
	'不同 action key 不能继承上一项确认状态',
);
now += 101;
assert(
	!gate.confirm('composer:close'),
	'超过期限的重复动作必须重新确认',
);
gate.clear();
assert(!gate.confirm('composer:close'), '显式清理必须释放确认期限');
