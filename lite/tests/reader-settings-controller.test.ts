import {
	READER_SETTINGS_GROUPS,
	READER_SETTINGS_PANELS,
	ReaderSettingsController,
	type ReaderSettingsDraftAdapter,
	type ReaderSettingsPanelId,
} from '../src/settings/reader-settings-controller.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const groupedPanelIds = READER_SETTINGS_GROUPS.flatMap(
	(group) => group.panelIds,
);
assert(
	READER_SETTINGS_GROUPS.length === 3 &&
	READER_SETTINGS_PANELS.length === 15 &&
	new Set(groupedPanelIds).size === 14 &&
	!new Set<ReaderSettingsPanelId>(groupedPanelIds).has('user') &&
	groupedPanelIds.join(',') === READER_SETTINGS_PANELS
		.filter((panel) => panel.id !== 'user')
		.map((panel) => panel.id)
		.join(','),
	'用户入口必须独立于三个设置分组，十四个设置页保持无重复稳定顺序',
);
assert(
	READER_SETTINGS_PANELS.find((panel) => panel.id === 'logs')
		?.description.includes('不保存查询参数、请求正文、Cookie、响应内容或个人数据') &&
	READER_SETTINGS_PANELS.find((panel) => panel.id === 'interaction')
		?.description ===
			'管理主帖操作列、二级回复显示位置与 Boost 文本复制规则。',
	'设置目录的用户可见标题与简介必须对齐主脚本，性能热更新说明除外',
);

interface Preferences {
	font: number;
	layout: number;
	accent: string;
}

let preferences: Readonly<Preferences> = Object.freeze({
	font: 1,
	layout: 2,
	accent: 'green',
});
let updates = 0;
let failPersist = false;
const controller = new ReaderSettingsController<Preferences>({
	preferences: {
		read: () => preferences,
		update(patch) {
			updates += 1;
			if (failPersist) throw new Error('storage unavailable');
			preferences = Object.freeze({ ...preferences, ...patch });
			return preferences;
		},
	},
});
const readSettingsSnapshot = () => controller.snapshot;
const readPreferences = () => preferences;
const readUpdates = () => updates;

controller.setQuery(' 请求 ');
assert(
	readSettingsSnapshot().query === '请求' &&
	readSettingsSnapshot().visiblePanelIds.join(',') === 'performance,logs' &&
	readSettingsSnapshot().activePanelId === 'performance',
	'设置搜索只能根据显式目录文案和关键词稳定选择首个匹配面板',
);
controller.setQuery('CTRL');
assert(
	readSettingsSnapshot().visiblePanelIds.join(',') === 'shortcuts' &&
	readSettingsSnapshot().activePanelId === 'shortcuts',
	'设置搜索必须规范化大小写并命中显式快捷键关键词',
);
controller.setQuery('不存在的设置');
assert(
	readSettingsSnapshot().visiblePanelIds.length === 0 &&
	readSettingsSnapshot().activePanelId === null,
	'无匹配搜索必须进入明确空状态',
);
controller.setQuery('');
assert(
	readSettingsSnapshot().visiblePanelIds.length === 15 &&
	readSettingsSnapshot().activePanelId === 'image',
	'清空搜索必须恢复完整目录和稳定首个设置面板',
);

function adapter(
	panelId: ReaderSettingsPanelId,
	options: {
		count?: () => number;
		validate?: () => readonly string[];
		patch?: () => Partial<Preferences>;
		accept?: (value: Readonly<Preferences>) => void;
		discard?: (value: Readonly<Preferences>) => void;
	} = {},
): ReaderSettingsDraftAdapter<Preferences> {
	return {
		panelId,
		changeCount: options.count ?? (() => 0),
		validate: options.validate ?? (() => []),
		createPatch: options.patch ?? (() => ({})),
		acceptPersisted: options.accept ?? (() => {}),
		discard: options.discard ?? (() => {}),
	};
}

const inactive = adapter('image');
const unregisterInactive = controller.registerDraft(inactive);
let unknownRejected = false;
try {
	controller.registerDraft(adapter('unknown' as ReaderSettingsPanelId));
} catch {
	unknownRejected = true;
}
let duplicateRejected = false;
try {
	controller.registerDraft(adapter('image'));
} catch {
	duplicateRejected = true;
}
assert(
	unknownRejected && duplicateRejected,
	'未知面板和同一面板的第二个草稿 owner 都必须被拒绝',
);
unregisterInactive();

let registrationFailed = false;
try {
	controller.registerDraft(adapter('image', {
		count: () => {
			throw new Error('draft not ready');
		},
	}));
} catch {
	registrationFailed = true;
}
const unregisterRegistrationRetry = controller.registerDraft(adapter('image'));
assert(
	registrationFailed,
	'首次读取草稿失败必须向注册调用方报告',
);
unregisterRegistrationRetry();

let fontChanges = 1;
let layoutChanges = 2;
let fontAccepted = 0;
let layoutAccepted = 0;
let discarded = 0;
const readFontAccepted = () => fontAccepted;
const readLayoutAccepted = () => layoutAccepted;
const readDiscarded = () => discarded;
const unregisterFont = controller.registerDraft(adapter('font', {
	count: () => fontChanges,
	validate: () => ['字体无效'],
	patch: () => ({ font: 3 }),
	accept: () => {
		fontAccepted += 1;
		fontChanges = 0;
	},
	discard: (value) => {
		assert(value === preferences, '放弃草稿必须共用同一当前偏好快照');
		fontChanges = 0;
		discarded += 1;
	},
}));
const unregisterLayout = controller.registerDraft(adapter('layout', {
	count: () => layoutChanges,
	validate: () => ['布局合计必须为 100%'],
	patch: () => ({ layout: 4 }),
	accept: () => {
		layoutAccepted += 1;
		layoutChanges = 0;
	},
	discard: (value) => {
		assert(value === preferences, '全部领域必须从同一偏好快照恢复预览');
		layoutChanges = 0;
		discarded += 1;
	},
}));

assert(
	readSettingsSnapshot().draftCount === 3 &&
	readSettingsSnapshot().drafts.map((draft) => draft.panelId).join(',') ===
		'font,layout',
	'草稿摘要必须按目录顺序聚合所有领域变更数',
);
const invalid = controller.saveAll();
assert(
	invalid.kind === 'invalid' &&
	invalid.issues.font?.[0] === '字体无效' &&
	invalid.issues.layout?.[0] === '布局合计必须为 100%' &&
	readUpdates() === 0 &&
	readSettingsSnapshot().draftCount === 3,
	'统一保存必须先完整收集校验错误，失败时零写入并保留全部草稿',
);

unregisterFont();
unregisterLayout();
let laterValidationCalls = 0;
const unregisterThrowingValidation = controller.registerDraft(adapter('font', {
	count: () => 1,
	validate: () => {
		throw new Error('font validator failed');
	},
}));
const unregisterLaterValidation = controller.registerDraft(adapter('layout', {
	count: () => 1,
	validate: () => {
		laterValidationCalls += 1;
		return ['布局仍需校验'];
	},
}));
const validationFailure = controller.saveAll();
assert(
	validationFailure.kind === 'failed' &&
	validationFailure.phase === 'validate' &&
	laterValidationCalls === 1 &&
	readUpdates() === 0,
	'单个 validator 抛错不得短路其他领域校验或形成写入',
);
unregisterThrowingValidation();
unregisterLaterValidation();

fontChanges = 1;
layoutChanges = 1;
const conflictFont = controller.registerDraft(adapter('font', {
	count: () => fontChanges,
	patch: () => ({ accent: 'blue' }),
}));
const conflictLayout = controller.registerDraft(adapter('layout', {
	count: () => layoutChanges,
	patch: () => ({ accent: 'red' }),
}));
const conflict = controller.saveAll();
assert(
	conflict.kind === 'conflict' &&
	conflict.keys.join(',') === 'accent' &&
	readUpdates() === 0,
	'两个领域写同一顶层偏好 key 必须在持久化前作为架构冲突拒绝',
);
conflictFont();
conflictLayout();

fontChanges = 1;
layoutChanges = 2;
const savedFont = controller.registerDraft(adapter('font', {
	count: () => fontChanges,
	patch: () => ({ font: 8 }),
	accept: (value) => {
		assert(value.font === 8 && value.layout === 9, '所有 owner 必须接受同一规范化结果');
		fontAccepted += 1;
		fontChanges = 0;
	},
	discard: () => {
		fontChanges = 0;
		discarded += 1;
	},
}));
const savedLayout = controller.registerDraft(adapter('layout', {
	count: () => layoutChanges,
	patch: () => ({ layout: 9 }),
	accept: (value) => {
		assert(value.font === 8 && value.layout === 9, '统一 patch 不得暴露中间偏好状态');
		layoutAccepted += 1;
		layoutChanges = 0;
	},
	discard: () => {
		layoutChanges = 0;
		discarded += 1;
	},
}));
const saved = controller.saveAll();
assert(
	saved.kind === 'saved' &&
	saved.synchronized &&
	saved.count === 3 &&
	readUpdates() === 1 &&
	readPreferences().font === 8 &&
	readPreferences().layout === 9 &&
	readFontAccepted() === 1 &&
	readLayoutAccepted() === 1 &&
	readSettingsSnapshot().draftCount === 0,
	'全部校验通过后必须只写一次偏好 revision，再让各领域接受同一结果',
);

fontChanges = 1;
layoutChanges = 1;
controller.refresh();
failPersist = true;
const failed = controller.saveAll();
assert(
	failed.kind === 'failed' &&
	failed.phase === 'persist' &&
	readUpdates() === 2 &&
	readFontAccepted() === 1 &&
	readLayoutAccepted() === 1 &&
	readSettingsSnapshot().draftCount === 2,
	'持久化失败必须保留所有草稿，且不得错误调用 acceptPersisted',
);
failPersist = false;
const discardSucceeded = controller.discardAll();
assert(
	discardSucceeded &&
	readDiscarded() === 2 &&
	readSettingsSnapshot().draftCount === 0,
	'明确放弃必须用当前偏好恢复所有领域预览并清空草稿摘要',
);

savedFont();
savedLayout();
controller.destroy();
let destroyedControllerRejected = false;
try {
	controller.registerDraft(adapter('font'));
} catch {
	destroyedControllerRejected = true;
}
assert(
	destroyedControllerRejected,
	'Settings controller 销毁后不得重新注册领域 owner 或恢复写路径',
);
