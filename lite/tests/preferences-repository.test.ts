import {
	PreferencesRepository,
	type PreferenceStoragePort,
} from '../src/state/preferences-repository.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestPreferences {
	readonly enabled: boolean;
	readonly depth: number;
	readonly layout: {
		readonly widths: readonly number[];
	};
}

class MemoryStorage implements PreferenceStoragePort {
	value: string | null = null;
	failWrite = false;

	getItem(): string | null {
		return this.value;
	}

	setItem(_key: string, value: string): void {
		if (this.failWrite) throw new Error('quota');
		this.value = value;
	}
}

const storage = new MemoryStorage();
const normalize = (input: Readonly<Record<string, unknown>>): TestPreferences =>
	Object.freeze({
		enabled: input.enabled !== false,
		depth: Math.min(8, Math.max(1, Math.trunc(Number(input.depth) || 1))),
		layout: (input.layout as TestPreferences['layout'] | undefined) ?? {
			widths: [30, 70],
		},
	});
const repository = new PreferencesRepository({
	key: 'prefs',
	storage,
	defaults: { enabled: true, depth: 2, layout: { widths: [30, 70] } },
	normalize,
});

storage.value = JSON.stringify({ depth: 99 });
const loaded = repository.load();
assert(loaded.value.enabled, '读取时必须合并 defaults');
assert(loaded.value.depth === 8, '读取时必须经过唯一 schema normalize');
assert(
	Object.isFrozen(loaded.value.layout) &&
		Object.isFrozen(loaded.value.layout.widths),
	'偏好 snapshot 的嵌套 profile/数组必须递归只读',
);
assert(loaded.source === 'initial' && loaded.revision === 1, '初始快照来源或 revision 错误');

const updated = repository.update({ enabled: false, depth: 4 });
assert(updated.value.enabled === false && updated.value.depth === 4, '局部更新结果错误');
assert(
	JSON.parse(storage.value ?? '{}').depth === 4,
	'局部更新必须先写入唯一 storage key',
);

const revisionBeforeFailure = repository.snapshot.revision;
storage.failWrite = true;
let writeFailed = false;
try {
	repository.update({ depth: 3 });
} catch {
	writeFailed = true;
}
assert(writeFailed, '持久化失败必须显式抛出');
assert(
	repository.snapshot.revision === revisionBeforeFailure &&
		repository.snapshot.value.depth === 4,
	'持久化失败不得发布内存假成功',
);
storage.failWrite = false;

const diagnostics: string[] = [];
repository.diagnostics.subscribe((event) => diagnostics.push(event.code));
storage.value = '{bad';
const fallback = repository.reloadExternal();
assert(
	fallback.source === 'fallback' &&
		fallback.value.enabled &&
		fallback.value.depth === 2,
	'损坏存储必须回落 defaults',
);
assert(diagnostics.includes('read-failed'), '损坏存储必须发布诊断');
assert(storage.value === '{bad', '读取损坏值时不得擅自覆盖原存储');

storage.value = JSON.stringify({ enabled: false, depth: 6 });
const external = repository.reloadExternal();
assert(
	external.source === 'external-reload' &&
		external.value.enabled === false &&
		external.value.depth === 6,
	'跨 tab reload 必须进入同一 normalize/commit 路径',
);

const replaced = repository.replace({ depth: 3 });
assert(
	replaced.source === 'replace' &&
	replaced.value.enabled &&
	replaced.value.depth === 3,
	'整份替换必须先合并 defaults',
);

const preparedStorage = new MemoryStorage();
preparedStorage.value = JSON.stringify({ depth: 3, preset: 'large' });
const preparedRepository = new PreferencesRepository({
	key: 'prepared-prefs',
	storage: preparedStorage,
	defaults: { enabled: true, depth: 2, layout: { widths: [30, 70] } },
	normalize,
	prepareStored: (value) => value.preset === 'large'
		? { ...value, depth: 8 }
		: value,
});
assert(
	preparedRepository.load().value.depth === 8,
	'仅存储读取入口必须允许 schema 在 normalize 前应用旧协议迁移',
);
assert(
	preparedRepository.update({ depth: 3 }).value.depth === 3,
	'存储入口准备逻辑不得污染普通局部更新',
);
