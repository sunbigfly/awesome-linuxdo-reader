import {
	ReaderNumericSettingsDraft,
} from '../src/settings/reader-numeric-settings-draft.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

type Name = 'count' | 'ratio';
const definitions = Object.freeze([
	Object.freeze({
		name: 'count',
		label: '数量',
		min: 1,
		max: 10,
		integer: true,
	}),
	Object.freeze({
		name: 'ratio',
		label: '比例',
		min: 0,
		max: 3,
		decimals: 2,
	}),
] as const);
const draft = new ReaderNumericSettingsDraft<Name>(
	definitions,
	{ count: 4, ratio: 1.25 },
);

assert(
	draft.changeCount() === 0 &&
		draft.rawValue('ratio') === '1.25',
	'数值草稿必须从规范 baseline 生成稳定 raw 值',
);
draft.setRaw('count', '4.0');
assert(
	draft.changeCount() === 0,
	'数值表达不同但语义相同不得形成伪草稿',
);
draft.setRaw('count', '5');
draft.rebase({ count: 6, ratio: 2 });
assert(
	draft.rawValue('count') === '5' &&
		draft.rawValue('ratio') === '2' &&
		draft.changeCount() === 1,
	'外部 rebase 必须保留本地已改字段并更新未改字段',
);
draft.setRaw('ratio', '4');
assert(
	draft.read() === null &&
		draft.issues()[0]?.includes('0–3') &&
		draft.changeCount() === 2,
	'越界值必须保留 raw 草稿、返回完整错误且禁止生成数值 patch',
);
draft.accept({ count: 8, ratio: 1 });
assert(
	draft.changeCount() === 0 &&
		draft.read()?.count === 8 &&
		draft.read()?.ratio === 1,
	'接受持久快照必须原子替换 baseline 与 raw 值',
);
