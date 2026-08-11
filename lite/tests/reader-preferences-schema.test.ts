import {
	READER_CONFIG_EXPORT_FORMAT,
	READER_CONFIG_EXPORT_VERSION,
	READER_PREFERENCES_STORAGE_KEY,
	createReaderPreferencesConfigCodec,
	createReaderPreferencesDefaults,
	createReaderPreferencesRepository,
	normalizeReaderPreferences,
	prepareStoredReaderPreferences,
} from '../src/state/reader-preferences-schema.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const environment = Object.freeze({
	viewportWidth: 1440,
	viewportHeight: 900,
});
const defaults = createReaderPreferencesDefaults(environment);
const expectedKeys = [
	'topicReaderMode',
	'imageProfile',
	'imageProfilesShared',
	'floatingImageProfile',
	'fullpageImageProfile',
	'mobileImageProfile',
	'lightboxOriginalByDefault',
	'lightboxCommentsExpandedByDefault',
	'lightboxDescriptionExpanded',
	'lightboxDescriptionHeight',
	'lightboxCommentsWidthPercent',
	'themeMode',
	'fontRenderingEnabled',
	'fontRenderingOnHost',
	'hostFontFamily',
	'hostFontCustomFamily',
	'hostFontWeight',
	'hostFontColor',
	'hostEmbeddedTitleScale',
	'hostEmbeddedAvatarScale',
	'hostEmbeddedStatsScale',
	'hostEmbeddedLabelCardScale',
	'fontProfile',
	'appearanceProfile',
	'performancePreset',
	'performancePageSize',
	'performanceStreamOverscan',
	'performanceStreamMaxItems',
	'performanceNestedPrefetch',
	'performanceRequestConcurrency',
	'performanceRequestInterval',
	'performanceRequestRateTarget',
	'layoutProfile',
	'fullpageLayoutProfile',
	'readerWindowWidth',
	'readerWindowHeight',
	'readerWindowX',
	'readerWindowY',
	'readerWindowLocked',
	'readerWindowPinned',
	'listReaderMode',
	'listReaderEmbedWidth',
	'composerWindowWidth',
	'composerWindowHeight',
	'composerWindowX',
	'composerWindowY',
	'historySortMode',
	'bookmarkTabOrder',
	'historyButtonsAlwaysVisible',
	'readerQueueAlwaysVisibleWhenEmpty',
	'historyEdgeTriggerPercent',
	'loadingAnimation',
	'translationMode',
	'openTopicsAtFirstPost',
	'doubleEscapeToCloseReader',
	'confirmNativeComposerClose',
	'readerShortcutBindings',
	'topicActionRailVisible',
	'topicActionRailFixed',
	'topicActionRailMode',
	'topicActionRailPositions',
	'expandNestedRepliesByDefault',
	'expandLeafNestedReplies',
	'aggregateDescendantReplies',
	'inlineReplyTreeMaxDepth',
	'hideNestedReplyFloors',
	'jumpHighlightColor',
	'jumpHighlightRadius',
	'jumpHighlightBorderWidth',
	'jumpHighlightRate',
	'jumpHighlightCount',
	'boostCopyMode',
	'boostCopyPrefix',
	'boostCopyCounterMarker',
	'boostCopyCounterStep',
	'boostCopyFixedSuffix',
];

assert(
	JSON.stringify(Object.keys(defaults)) === JSON.stringify(expectedKeys),
	'默认偏好必须保持旧 72 字段顺序并追加 4 个图片形态字段',
);
assert(
	defaults.listReaderEmbedWidth === 648 &&
	defaults.performancePreset === 'balanced' &&
	defaults.performancePageSize === 48 &&
	defaults.performanceStreamOverscan === 1.5 &&
	defaults.performanceStreamMaxItems === 80 &&
	defaults.performanceNestedPrefetch === 2.5 &&
	defaults.performanceRequestConcurrency === 3 &&
	defaults.performanceRequestInterval === 100 &&
	defaults.performanceRequestRateTarget === 85 &&
	defaults.inlineReplyTreeMaxDepth === 3 &&
	defaults.jumpHighlightCount === 1 &&
	!defaults.confirmNativeComposerClose &&
	!normalizeReaderPreferences({}, environment).confirmNativeComposerClose &&
	normalizeReaderPreferences(
		{ confirmNativeComposerClose: true },
		environment,
	).confirmNativeComposerClose,
	'视口、请求目标、回复树深度、闪烁或原生回复关闭默认值偏移',
);
assert(
	normalizeReaderPreferences({ ...defaults, imageProfile: {} }, environment)
		.imageProfile.preset === '50',
	'图片 profile 缺少 preset 时必须回落旧版 50% 默认值',
);
const independentImages = normalizeReaderPreferences({
	...defaults,
	imageProfilesShared: false,
	floatingImageProfile: { preset: '100', custom: 100 },
	fullpageImageProfile: { preset: '125', custom: 125 },
	mobileImageProfile: { preset: '150', custom: 150 },
}, environment);
assert(
	defaults.imageProfilesShared &&
		defaults.floatingImageProfile === defaults.imageProfile &&
		independentImages.floatingImageProfile.preset === '100' &&
		independentImages.fullpageImageProfile.preset === '125' &&
		independentImages.mobileImageProfile.preset === '150',
	'旧配置必须默认共享图片 profile，关闭共享后才保留三形态独立值',
);
assert(
	READER_PREFERENCES_STORAGE_KEY === 'linuxdo-enhanced-reader:prefs' &&
	READER_CONFIG_EXPORT_FORMAT === 'awesome-linuxdo-reader-settings' &&
	READER_CONFIG_EXPORT_VERSION === 5,
	'存储与导出协议常量必须保持兼容',
);

const railPosition = { x: 'unexpected', y: 99 };
const normalized = normalizeReaderPreferences({
	...defaults,
	unknown: 'drop',
	imageProfile: { preset: 'bad', custom: 999 },
	lightboxDescriptionHeight: 999,
	lightboxCommentsWidthPercent: 99,
	hostFontFamily: 'bad',
	hostFontCustomFamily: '  A\";{}  B  ',
	hostFontWeight: 999,
	hostEmbeddedAvatarScale: 1,
	fontProfile: {
		family: 'serif',
		customFamily: 'Root',
		weight: 600,
		interfaceColor: '#ABCDEF',
		interface: 999,
		postFamily: 'bad',
		postCustomFamily: null,
		postWeight: 999,
		postColor: 'bad',
		post: 1,
		composerFamily: 'custom',
		composerCustomFamily: '  Local  Font ',
		composerWeight: 300,
		composerColor: '#123456',
		composer: 101,
	},
	appearanceProfile: {
		accentColorDark: '#112233',
		replyLineWidth: 3.74,
		replyLineRadius: 99,
		structureColorsEnabled: false,
	},
	performancePageSize: 999,
	performanceStreamOverscan: 0,
	performanceStreamMaxItems: 2,
	performanceNestedPrefetch: 9,
	performanceRequestConcurrency: 9,
	performanceRequestInterval: 101.6,
	performanceRequestRateTarget: 2,
	layoutProfile: { left: 50, main: 90, gap: 30, timeline: 20, right: 20 },
	readerWindowWidth: 1,
	readerWindowHeight: 1,
	readerWindowX: -1,
	readerWindowY: 33.6,
	readerWindowLocked: 'yes',
	listReaderMode: 'bad',
	listReaderEmbedWidth: 1,
	composerWindowWidth: 33.6,
	historySortMode: 'bad',
	bookmarkTabOrder: ['Post', 'Post', 'bad'],
	historyEdgeTriggerPercent: 99,
	loadingAnimation: 'bad',
	translationMode: 'bad',
	readerShortcutBindings: {
		historyBack: ['Ctrl+KeyA', 'Ctrl+KeyA', 'Bad+KeyB'],
		historyForward: ['Ctrl+KeyA', 'Mouse2', 'Mouse4'],
		closeReader: ['Escape', 'Escape', 'Alt+Escape', 'Shift+Escape'],
	},
	topicActionRailMode: 'expanded',
	topicActionRailPositions: undefined,
	topicActionRailPosition: railPosition,
	expandNestedRepliesByDefault: false,
	expandLeafNestedReplies: false,
	aggregateDescendantReplies: false,
	inlineReplyTreeMaxDepth: 99,
	jumpHighlightColor: '#ABCDEF',
	jumpHighlightRate: 1.26,
	boostCopyMode: 'bad',
	boostCopyPrefix: '12345678901234567890',
	boostCopyCounterMarker: '123',
	boostCopyCounterStep: 999,
}, environment);

assert(
	normalized.imageProfile.preset === '100' &&
	normalized.imageProfile.custom === 200,
	'图片 profile 必须沿用旧版 preset/custom 归一化',
);
assert(
	normalized.lightboxDescriptionHeight === 360 &&
	normalized.lightboxCommentsWidthPercent === 50,
	'大图描述高度必须受视口约束，评论宽度必须限幅',
);
assert(
	normalized.hostFontFamily === 'system' &&
	normalized.hostFontCustomFamily === 'A B' &&
	normalized.hostFontWeight === 400 &&
	normalized.hostEmbeddedAvatarScale === 50,
	'宿主字体或嵌入比例归一化偏移',
);
assert(
	normalized.fontProfile.postFamily === 'serif' &&
	normalized.fontProfile.postCustomFamily === 'Root' &&
	normalized.fontProfile.postWeight === 600 &&
	normalized.fontProfile.interfaceColor === '#abcdef' &&
	normalized.fontProfile.interface === 250 &&
	normalized.fontProfile.post === 50,
	'字体 profile 的上级继承、颜色或范围归一化偏移',
);
assert(
	normalized.appearanceProfile.accentColor === '#112233' &&
	normalized.appearanceProfile.accentColorDark === '#112233' &&
	normalized.appearanceProfile.replyLineWidth === 3.5 &&
	normalized.appearanceProfile.replyLineRadius === 16 &&
	normalized.appearanceProfile.structureColorsEnabled === false,
	'外观 profile 必须保持旧版 light/dark 兼容和步长规则',
);
assert(
	normalized.performancePreset === 'custom' &&
	normalized.performancePageSize === 64 &&
	normalized.performanceStreamOverscan === 0.25 &&
	normalized.performanceStreamMaxItems === 24 &&
	normalized.performanceNestedPrefetch === 3 &&
	normalized.performanceRequestConcurrency === 4 &&
	normalized.performanceRequestInterval === 102 &&
	normalized.performanceRequestRateTarget === 50,
	'性能参数限幅或 custom 识别偏移',
);
assert(
	Object.values(normalized.layoutProfile).reduce((sum, value) => sum + value, 0)
		<= 100.01,
	'布局比例必须按旧版算法压回 100%',
);
assert(
	normalized.readerWindowWidth === 360 &&
	normalized.readerWindowHeight === 320 &&
	normalized.readerWindowX === 0 &&
	normalized.readerWindowY === 34 &&
	normalized.readerWindowLocked &&
	normalized.listReaderMode === 'floating' &&
	normalized.listReaderEmbedWidth === 360 &&
	normalized.composerWindowWidth === 34,
	'窗口和列表几何归一化偏移',
);
assert(
	JSON.stringify(normalized.bookmarkTabOrder) ===
		JSON.stringify(['Post', 'Reaction', 'Topic']) &&
	normalized.historyEdgeTriggerPercent === 15 &&
	normalized.loadingAnimation === 'quoteecho' &&
	normalized.translationMode === 'original',
	'历史、收藏、加载动画或翻译枚举归一化偏移',
);
assert(
	JSON.stringify(normalized.readerShortcutBindings.historyBack) ===
		JSON.stringify(['Ctrl+KeyA']) &&
	JSON.stringify(normalized.readerShortcutBindings.historyForward) ===
		JSON.stringify(['Mouse2', 'Mouse4']) &&
	normalized.readerShortcutBindings.closeReader.length === 3,
	'快捷键必须按旧版通用 code 规则、动作顺序全局去重并限制每项三条',
);
assert(
	normalized.topicActionRailMode === 'compact' &&
	Object.values(normalized.topicActionRailPositions).every((position) =>
		position.x === 'left' && position.y === 1
	),
	'动作列 mode 必须保持旧版语义，并把旧单位置无损迁移到三个形态槽位',
);
const independentRailPositions = normalizeReaderPreferences({
	...defaults,
	topicActionRailPositions: {
		floating: { x: 0.2, y: 0.3 },
		fullpage: { x: 'right', y: 0.4 },
		embedded: { x: 0.6, y: 0.7 },
	},
}, environment).topicActionRailPositions;
assert(
	independentRailPositions.floating.x === 0.2 &&
		independentRailPositions.floating.y === 0.3 &&
		independentRailPositions.fullpage.x === 'right' &&
		independentRailPositions.fullpage.y === 0.4 &&
		independentRailPositions.embedded.x === 0.6 &&
		independentRailPositions.embedded.y === 0.7,
	'浮窗、全屏和嵌入操作列位置必须分别归一化并持久化，互不覆盖',
);
assert(
	normalized.expandNestedRepliesByDefault === true &&
	normalized.inlineReplyTreeMaxDepth === 5,
	'未启用叶节点展开时，旧版树状展开不变量或深度范围偏移',
);
assert(
	normalized.jumpHighlightColor === '#abcdef' &&
	normalized.jumpHighlightRate === 1.3 &&
	normalized.boostCopyMode === 'counter' &&
	normalized.boostCopyPrefix.length === 16 &&
	normalized.boostCopyCounterMarker === '+' &&
	normalized.boostCopyCounterStep === 99,
	'跳转提示或 Boost 文本规则偏移',
);
assert(!Object.hasOwn(normalized, 'unknown'), '未知偏好字段必须被唯一 schema 丢弃');

const leafExpansion = normalizeReaderPreferences({
	...defaults,
	expandNestedRepliesByDefault: false,
	expandLeafNestedReplies: true,
	aggregateDescendantReplies: false,
}, environment);
assert(
	leafExpansion.expandNestedRepliesByDefault === false,
	'启用叶节点展开时必须允许关闭父级默认展开',
);
const aggregateExpansion = normalizeReaderPreferences({
	...defaults,
	expandNestedRepliesByDefault: false,
	expandLeafNestedReplies: true,
	aggregateDescendantReplies: true,
}, environment);
assert(
	aggregateExpansion.expandNestedRepliesByDefault === true,
	'聚合子孙回复必须强制父级默认展开',
);

const storedPrepared = prepareStoredReaderPreferences({
	performancePreset: 'low',
	performancePageSize: 64,
	performanceRequestConcurrency: 4,
});
const storedNormalized = normalizeReaderPreferences(
	{ ...defaults, ...storedPrepared },
	environment,
);
assert(
	storedNormalized.performancePreset === 'low' &&
	storedNormalized.performancePageSize === 24 &&
	storedNormalized.performanceRequestConcurrency === 2,
	'存储入口的命名性能预设必须覆盖旧的单项值',
);
const rebasedBalanced = normalizeReaderPreferences({
	...defaults,
	...prepareStoredReaderPreferences({
		performancePreset: 'balanced',
		performancePageSize: 40,
		performanceNestedPrefetch: 1.25,
		performanceRequestRateTarget: 95,
	}),
}, environment);
assert(
	rebasedBalanced.performancePageSize === 48 &&
		rebasedBalanced.performanceNestedPrefetch === 2.5 &&
		rebasedBalanced.performanceRequestRateTarget === 85,
	'已保存的命名均衡预设必须自动跟进现行 API 管线，不能永久冻结旧测试参数',
);
const localNormalized = normalizeReaderPreferences({
	...defaults,
	performancePreset: 'balanced',
	performancePageSize: 55,
}, environment);
assert(
	localNormalized.performancePreset === 'custom' &&
	localNormalized.performancePageSize === 55,
	'普通局部更新不得被旧 performancePreset 反向覆盖',
);

const repositoryStorage = {
	value: JSON.stringify({
		performancePreset: 'low',
		performancePageSize: 64,
	}),
	getItem(): string | null {
		return this.value;
	},
	setItem(_key: string, value: string): void {
		this.value = value;
	},
};
const repository = createReaderPreferencesRepository({
	environment,
	storage: repositoryStorage,
});
assert(
	repository.load().value.performancePageSize === 24,
	'真实偏好 repository 必须在存储入口应用命名性能预设',
);
assert(
	repository.update({ performancePageSize: 55 }).value.performancePreset === 'custom',
	'真实偏好 repository 的局部更新必须重新识别 custom',
);

const codec = createReaderPreferencesConfigCodec({
	environment,
	scriptVersion: '0.1.16',
	now: () => new Date('2026-07-29T10:00:00.000Z'),
});
const exported = codec.export({
	...defaults,
	performancePageSize: 999,
	unknown: true,
});
assert(
	exported.settingsCount === 76 &&
	Object.keys(exported.settings).length === 76 &&
	exported.settings.performancePageSize === 64 &&
	!Object.hasOwn(exported.settings, 'unknown'),
	'真实配置 codec 必须复用同一 76 字段 schema',
);
const legacySettings = Object.fromEntries(
	Object.entries(defaults).filter(([key]) =>
		![
			'readerShortcutBindings',
			'topicActionRailMode',
			'inlineReplyTreeMaxDepth',
		].includes(key)),
);
const imported = codec.import({
	format: READER_CONFIG_EXPORT_FORMAT,
	schemaVersion: READER_CONFIG_EXPORT_VERSION,
	scriptVersion: 'old',
	exportedAt: '2026-01-01T00:00:00.000Z',
	settingsCount: Object.keys(legacySettings).length,
	settings: legacySettings,
});
assert(
	imported.topicActionRailMode === 'compact' &&
	imported.inlineReplyTreeMaxDepth === 1 &&
	imported.readerShortcutBindings.closeReader[0] === 'Escape',
	'真实 codec 必须保留旧版交互字段导入规则',
);

let invalidEnvironmentRejected = false;
try {
	createReaderPreferencesDefaults({
		viewportWidth: Number.NaN,
		viewportHeight: 900,
	});
} catch (error) {
	invalidEnvironmentRejected = error instanceof RangeError;
}
assert(invalidEnvironmentRejected, '偏好 schema 不得隐式读取或容忍未知浏览器视口');
