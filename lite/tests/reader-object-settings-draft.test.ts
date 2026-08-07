import {
	ReaderObjectSettingsDraft,
} from '../src/settings/reader-object-settings-draft.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestProfile {
	readonly color: string;
	readonly width: number;
	readonly enabled: boolean;
}

const draft = new ReaderObjectSettingsDraft<
	TestProfile,
	keyof TestProfile
>(
	['color', 'width', 'enabled'],
	{ color: '#112233', width: 1, enabled: true },
);

assert(
	draft.changeCount() === 0 &&
		draft.read().color === '#112233',
	'对象草稿必须从不可变 baseline 开始且不得制造伪变更',
);
draft.set('width', 2);
draft.rebase({ color: '#445566', width: 3, enabled: false });
assert(
	draft.read().color === '#445566' &&
		draft.read().width === 2 &&
		draft.read().enabled === false &&
		draft.changeCount() === 1,
	'外部 rebase 必须更新未编辑字段并保留本地脏字段',
);
draft.setValues({ width: 3, enabled: true });
assert(
	draft.changeCount() === 1 &&
		draft.dirtyNames()[0] === 'enabled',
	'批量更新必须按当前 baseline 重新计算逐字段脏状态',
);
draft.accept({ color: '#abcdef', width: 4, enabled: true });
assert(
	draft.changeCount() === 0 &&
		draft.read().color === '#abcdef' &&
		draft.baseline().width === 4,
	'接受持久快照必须原子替换 baseline 与当前对象',
);

const converging = new ReaderObjectSettingsDraft<
	TestProfile,
	keyof TestProfile
>(
	['color', 'width', 'enabled'],
	{ color: '#112233', width: 1, enabled: true },
);
converging.set('width', 2);
const convergenceChanged = converging.rebase({
	color: '#112233',
	width: 2,
	enabled: true,
});
assert(
	convergenceChanged &&
		converging.changeCount() === 0,
	'外部偏好追上本地脏值时 rebase 必须报告草稿状态变化，调用方才能刷新统一未保存计数',
);
