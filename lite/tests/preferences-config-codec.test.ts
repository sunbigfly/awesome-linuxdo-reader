import { PreferencesConfigCodec } from '../src/state/preferences-config-codec.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestPreferences {
	readonly layoutProfile: string;
	readonly fullpageLayoutProfile: string;
	readonly confirmNativeComposerClose: boolean;
	readonly readerShortcutBindings: readonly string[];
	readonly topicActionRailMode: string;
	readonly inlineReplyTreeMaxDepth: number;
}

const defaults: TestPreferences = {
	layoutProfile: 'floating',
	fullpageLayoutProfile: 'fullpage',
	confirmNativeComposerClose: true,
	readerShortcutBindings: ['Escape'],
	topicActionRailMode: 'compact',
	inlineReplyTreeMaxDepth: 1,
};
const normalize = (input: Readonly<Record<string, unknown>>): TestPreferences =>
	Object.freeze({
		layoutProfile: String(input.layoutProfile || 'floating'),
		fullpageLayoutProfile: String(input.fullpageLayoutProfile || 'fullpage'),
		confirmNativeComposerClose: input.confirmNativeComposerClose !== false,
		readerShortcutBindings: Array.isArray(input.readerShortcutBindings)
			? input.readerShortcutBindings.map(String)
			: ['Escape'],
		topicActionRailMode: input.topicActionRailMode === 'collapsed'
			? 'collapsed'
			: 'compact',
		inlineReplyTreeMaxDepth: Math.min(
			5,
			Math.max(1, Math.trunc(Number(input.inlineReplyTreeMaxDepth) || 1)),
		),
	});
const codec = new PreferencesConfigCodec({
	format: 'awesome-linuxdo-reader-settings',
	schemaVersion: 5,
	scriptVersion: '0.1.16',
	defaults,
	normalize,
	legacyImportRules: [
		{ missingDefaults: { fullpageLayoutProfile: 'fullpage' } },
		{
			missingDefaults: {
				fullpageLayoutProfile: 'fullpage',
				confirmNativeComposerClose: true,
			},
		},
		{
			missingDefaults: {
				readerShortcutBindings: ['Escape'],
				topicActionRailMode: 'compact',
				inlineReplyTreeMaxDepth: 1,
			},
		},
	],
	now: () => new Date('2026-07-29T10:00:00.000Z'),
});

const exported = codec.export({
	...defaults,
	inlineReplyTreeMaxDepth: 99,
	unknown: 'drop',
});
assert(
	exported.settingsCount === 6 &&
	Object.keys(exported.settings).length === 6 &&
	!Object.hasOwn(exported.settings, 'unknown'),
	'导出只能包含 defaults 定义的 canonical 字段',
);
assert(
	exported.settings.inlineReplyTreeMaxDepth === 5 &&
	exported.exportedAt === '2026-07-29T10:00:00.000Z',
	'导出必须先走共用 normalize 并写稳定时间',
);

function legacyPayload(
	missingKeys: readonly (keyof TestPreferences)[],
): Record<string, unknown> {
	const settings = Object.fromEntries(
		Object.entries(defaults).filter(([key]) =>
			!missingKeys.includes(key as keyof TestPreferences)),
	);
	return {
		format: 'awesome-linuxdo-reader-settings',
		schemaVersion: 5,
		scriptVersion: 'old',
		exportedAt: '2026-01-01T00:00:00.000Z',
		settingsCount: Object.keys(settings).length,
		settings,
	};
}

assert(
	codec.import(legacyPayload(['fullpageLayoutProfile'])).fullpageLayoutProfile ===
		'fullpage',
	'旧版缺少 fullpage layout 必须由显式迁移规则补齐',
);
assert(
	codec.import(legacyPayload([
		'fullpageLayoutProfile',
		'confirmNativeComposerClose',
	])).confirmNativeComposerClose,
	'旧版原生编辑器关闭偏好必须兼容',
);
const legacyInteraction = codec.import(legacyPayload([
	'readerShortcutBindings',
	'topicActionRailMode',
	'inlineReplyTreeMaxDepth',
]));
assert(
	legacyInteraction.topicActionRailMode === 'compact' &&
	legacyInteraction.inlineReplyTreeMaxDepth === 1 &&
	legacyInteraction.readerShortcutBindings[0] === 'Escape',
	'旧版交互字段必须由单一规则补齐',
);

for (const invalid of [
	{
		...legacyPayload([]),
		settingsCount: 1,
	},
	{
		...legacyPayload([]),
		settings: { ...defaults, unknown: true },
		settingsCount: 7,
	},
	legacyPayload(['layoutProfile']),
	{
		...legacyPayload([]),
		schemaVersion: '5',
	},
	{
		...legacyPayload([]),
		settingsCount: '6',
	},
	{
		...legacyPayload([]),
		scriptVersion: 5,
	},
	{
		...legacyPayload([]),
		exportedAt: 5,
	},
	{
		...legacyPayload([]),
		unexpected: true,
	},
	null,
]) {
	let rejected = false;
	try {
		codec.import(invalid);
	} catch (error) {
		rejected = error instanceof Error && error.message.includes('invalid_config');
	}
	assert(
		rejected,
		'元数据类型错误、计数错误、未知字段或非兼容缺失字段必须拒绝',
	);
}
