import { PreferencesConfigCodec } from './preferences-config-codec.js';
import {
	PreferencesRepository,
	type PreferenceStoragePort,
} from './preferences-repository.js';
import {
	DEFAULT_BOOST_COPY_SETTINGS,
	normalizeBoostCopySettings,
} from './reader-boost-copy-settings.js';
import {
	DEFAULT_READER_TRANSLATION_THEME,
	normalizeReaderTranslationTheme,
	type ReaderTranslationTheme,
} from '../translation/reader-translation-presentation.js';
import {
	normalizeReaderUnwantedTopicFilterPreferences,
	readerPreferencesUnwantedTopicFilterAdapter,
} from '../collection/reader-unwanted-topic-filter.js';

export const READER_PREFERENCES_STORAGE_KEY = 'linuxdo-enhanced-reader:prefs';
export const READER_CONFIG_EXPORT_FORMAT = 'awesome-linuxdo-reader-settings';
export const READER_CONFIG_EXPORT_VERSION = 5;

export interface ReaderPreferencesEnvironment {
	readonly viewportWidth: number;
	readonly viewportHeight: number;
}

export interface ReaderImageProfile {
	readonly preset: '25' | '50' | '100' | '125' | '150' | '200' | 'custom';
	readonly custom: number;
}

export interface ReaderFontProfile {
	readonly family: ReaderFontFamily;
	readonly customFamily: string;
	readonly weight: ReaderFontWeight;
	readonly interfaceColor: string;
	readonly interface: number;
	readonly postFamily: ReaderFontFamily;
	readonly postCustomFamily: string;
	readonly postWeight: ReaderFontWeight;
	readonly postColor: string;
	readonly post: number;
	readonly composerFamily: ReaderFontFamily;
	readonly composerCustomFamily: string;
	readonly composerWeight: ReaderFontWeight;
	readonly composerColor: string;
	readonly composer: number;
}

export interface ReaderAppearanceProfile {
	readonly accentColor: string;
	readonly accentColorDark: string;
	readonly linkColor: string;
	readonly linkColorDark: string;
	readonly zebraColor: string;
	readonly zebraColorDark: string;
	readonly zebraRadius: number;
	readonly listZebraColor: string;
	readonly listZebraColorDark: string;
	readonly structureColorsEnabled: boolean;
	readonly replyLineColor: string;
	readonly replyLineColorDark: string;
	readonly replyLineWidth: number;
	readonly replyLineRadius: number;
	readonly quoteLineColor: string;
	readonly quoteLineColorDark: string;
	readonly quoteLineWidth: number;
	readonly dividerLineColor: string;
	readonly dividerLineColorDark: string;
	readonly dividerLineWidth: number;
}

export type ReaderAppearanceColorName =
	| 'accentColor'
	| 'linkColor'
	| 'zebraColor'
	| 'listZebraColor'
	| 'replyLineColor'
	| 'quoteLineColor'
	| 'dividerLineColor';

export type ReaderAppearanceSettingName =
	| ReaderAppearanceColorName
	| 'zebraRadius'
	| 'structureColorsEnabled'
	| 'replyLineWidth'
	| 'replyLineRadius'
	| 'quoteLineWidth'
	| 'dividerLineWidth';

export type ReaderAppearanceEditableProfile = Readonly<
	Pick<ReaderAppearanceProfile, ReaderAppearanceSettingName>
>;

export type ReaderAppearanceTheme = 'light' | 'dark';

export interface ReaderLayoutProfile {
	readonly left: number;
	readonly main: number;
	readonly gap: number;
	readonly timeline: number;
	readonly right: number;
}

export type ReaderFontFamily =
	| 'site'
	| 'system'
	| 'cjkSans'
	| 'serif'
	| 'monospace'
	| 'custom';
export type ReaderFontWeight = 300 | 400 | 500 | 600;
export type ReaderPerformancePreset = 'low' | 'balanced' | 'high' | 'custom';
export type ReaderShortcutAction = keyof typeof READER_SHORTCUT_DEFAULTS;
export type ReaderShortcutBindings = Readonly<
	Record<ReaderShortcutAction, readonly string[]>
>;

export interface ReaderPreferences {
	readonly topicReaderMode: 'floating' | 'fullpage';
	readonly imageProfile: ReaderImageProfile;
	readonly imageProfilesShared: boolean;
	readonly floatingImageProfile: ReaderImageProfile;
	readonly fullpageImageProfile: ReaderImageProfile;
	readonly mobileImageProfile: ReaderImageProfile;
	readonly lightboxOriginalByDefault: boolean;
	readonly lightboxCommentsExpandedByDefault: boolean;
	readonly lightboxDescriptionExpanded: boolean;
	readonly lightboxDescriptionHeight: number;
	readonly lightboxCommentsWidthPercent: number;
	readonly themeMode: 'light' | 'dark' | 'system';
	readonly autoDarkModeEnabled: boolean;
	readonly autoDarkModeStartTime: 'sunset' | string;
	readonly fontRenderingEnabled: boolean;
	readonly fontRenderingOnHost: boolean;
	readonly hostFontFamily: ReaderFontFamily;
	readonly hostFontCustomFamily: string;
	readonly hostFontWeight: ReaderFontWeight;
	readonly hostFontColor: string;
	readonly hostEmbeddedTitleScale: number;
	readonly hostEmbeddedAvatarScale: number;
	readonly hostEmbeddedStatsScale: number;
	readonly hostEmbeddedLabelCardScale: number;
	readonly fontProfile: ReaderFontProfile;
	readonly appearanceProfile: ReaderAppearanceProfile;
	readonly performancePreset: ReaderPerformancePreset;
	readonly performancePageSize: number;
	readonly performanceStreamOverscan: number;
	readonly performanceStreamMaxItems: number;
	readonly performanceNestedPrefetch: number;
	readonly performanceRequestConcurrency: number;
	readonly performanceRequestInterval: number;
	readonly performanceRequestRateTarget: number;
	readonly layoutProfile: ReaderLayoutProfile;
	readonly fullpageLayoutProfile: ReaderLayoutProfile;
	readonly readerWindowWidth: number;
	readonly readerWindowHeight: number;
	readonly readerWindowX: number;
	readonly readerWindowY: number;
	readonly readerWindowLocked: boolean;
	readonly readerWindowPinned: boolean;
	readonly listReaderMode: 'floating' | 'fullpage' | 'embed-left' | 'embed-right';
	readonly listReaderEmbedWidth: number;
	readonly composerWindowWidth: number;
	readonly composerWindowHeight: number;
	readonly composerWindowX: number;
	readonly composerWindowY: number;
	readonly historySortMode: 'first-viewed' | 'recent-viewed';
	readonly bookmarkTabOrder: readonly BookmarkTabType[];
	readonly historyButtonsAlwaysVisible: boolean;
	readonly readerQueueAlwaysVisibleWhenEmpty: boolean;
	readonly historyEdgeTriggerPercent: number;
	readonly loadingAnimation: ReaderLoadingAnimation;
	readonly translationMode: 'original' | 'bilingual' | 'translation';
	readonly translationTheme: ReaderTranslationTheme;
	readonly openTopicsAtFirstPost: boolean;
	readonly doubleEscapeToCloseReader: boolean;
	readonly confirmNativeComposerClose: boolean;
	readonly readerShortcutBindings: ReaderShortcutBindings;
	readonly topicActionRailVisible: boolean;
	readonly topicActionRailFixed: boolean;
	readonly topicActionRailMode: 'collapsed' | 'compact';
	readonly topicActionRailPositions: ReaderTopicActionRailPositions;
	readonly unwantedTopicFilterEnabled: boolean;
	readonly unwantedTopicFilterCategories: readonly string[];
	readonly unwantedTopicFilterLabels: readonly string[];
	readonly unwantedTopicFilterTopicAuthors: readonly string[];
	readonly unwantedTopicFilterTopicFields: readonly string[];
	readonly unwantedTopicFilterPostAuthors: readonly string[];
	readonly expandNestedRepliesByDefault: boolean;
	readonly expandLeafNestedReplies: boolean;
	readonly aggregateDescendantReplies: boolean;
	readonly inlineReplyTreeMaxDepth: number;
	readonly hideNestedReplyFloors: boolean;
	readonly jumpHighlightColor: string;
	readonly jumpHighlightRadius: number;
	readonly jumpHighlightBorderWidth: number;
	readonly jumpHighlightRate: number;
	readonly jumpHighlightCount: number;
	readonly boostCopyMode: 'counter' | 'text';
	readonly boostCopyPrefix: string;
	readonly boostCopyCounterMarker: string;
	readonly boostCopyCounterStep: number;
	readonly boostCopyFixedSuffix: string;
}

export interface ReaderTopicActionRailPosition {
	readonly x: 'left' | 'right' | number;
	readonly y: number;
}

export interface ReaderTopicActionRailPositions {
	readonly floating: ReaderTopicActionRailPosition;
	readonly fullpage: ReaderTopicActionRailPosition;
	readonly embedded: ReaderTopicActionRailPosition;
}

type BookmarkTabType = 'Reaction' | 'Boost' | 'Reply' | 'Topic' | 'Post';
export type ReaderLoadingAnimation =
	| 'random'
	| 'portal'
	| 'constellation'
	| 'corridor'
	| 'typewave'
	| 'crystal'
	| 'marginalia'
	| 'chapters'
	| 'quoteecho'
	| 'footnotes'
	| 'inkverse';

export interface ReaderPerformanceConfig {
	readonly pageSize: number;
	readonly streamOverscanViewports: number;
	readonly streamMaxItems: number;
	readonly nestedPrefetchViewports: number;
	readonly requestMaxConcurrent: number;
	readonly requestMinInterval: number;
	readonly requestRateTarget: number;
}

export type ReaderPerformanceName = keyof ReaderPerformanceConfig;
type PerformanceName = ReaderPerformanceName;

export interface ReaderPerformanceLimit {
	readonly min: number;
	readonly max: number;
	readonly integer?: boolean;
}
type NumericLimit = ReaderPerformanceLimit;

const IMAGE_SCALE_OPTIONS = Object.freeze([25, 50, 100, 125, 150, 200]);
export const LIGHTBOX_DESCRIPTION_HEIGHT_MIN = 56;
export const LIGHTBOX_DESCRIPTION_HEIGHT_DEFAULT = 120;
export const LIGHTBOX_COMMENTS_WIDTH_DEFAULT = 25;
export const LIGHTBOX_COMMENTS_WIDTH_MIN = 18;
export const LIGHTBOX_COMMENTS_WIDTH_MAX = 50;
const IMAGE_SCALE_MIN = 50;
const IMAGE_SCALE_MAX = 200;
const FONT_SCALE_MIN = 50;
const FONT_SCALE_MAX = 250;
const COMPOSER_FONT_SCALE_DEFAULT = 80;
const HOST_EMBED_SIZE_MIN = 50;
const HOST_EMBED_SIZE_MAX = 200;
const READER_WINDOW_MIN_WIDTH = 360;
const READER_WINDOW_MIN_HEIGHT = 320;
const READER_EMBED_MIN_WIDTH = 360;
const HISTORY_EDGE_TRIGGER_MIN = 0;
const HISTORY_EDGE_TRIGGER_MAX = 15;
const HISTORY_EDGE_TRIGGER_DEFAULT = 15;
const INLINE_REPLY_TREE_DEFAULT_DEPTH = 3;
const INLINE_REPLY_TREE_MAX_DEPTH = 5;

const FONT_FAMILIES = new Set<ReaderFontFamily>([
	'site',
	'system',
	'cjkSans',
	'serif',
	'monospace',
	'custom',
]);
const FONT_WEIGHTS = new Set<ReaderFontWeight>([300, 400, 500, 600]);
const BOOKMARK_TAB_TYPES = Object.freeze<readonly BookmarkTabType[]>([
	'Reply',
	'Boost',
	'Reaction',
	'Topic',
	'Post',
]);
export const READER_LOADING_ANIMATION_KEYS = Object.freeze([
	'portal',
	'constellation',
	'corridor',
	'typewave',
	'crystal',
	'marginalia',
	'chapters',
	'quoteecho',
	'footnotes',
	'inkverse',
] as const satisfies readonly Exclude<ReaderLoadingAnimation, 'random'>[]);
const READER_LOADING_ANIMATIONS = new Set<ReaderLoadingAnimation>(
	READER_LOADING_ANIMATION_KEYS,
);
const LAYOUT_KEYS = Object.freeze<readonly (keyof ReaderLayoutProfile)[]>([
	'left',
	'main',
	'gap',
	'timeline',
	'right',
]);

export const READER_LAYOUT_DEFAULT = Object.freeze<ReaderLayoutProfile>({
	left: 0,
	main: 88,
	gap: 0,
	timeline: 8,
	right: 4,
});
export const READER_FULLPAGE_LAYOUT_DEFAULT = Object.freeze<ReaderLayoutProfile>({
	left: 15,
	main: 70,
	gap: 5,
	timeline: 8,
	right: 2,
});
const LAYOUT_MIN_RATIOS = Object.freeze<ReaderLayoutProfile>({
	left: 0,
	main: 40,
	gap: 0,
	timeline: 6,
	right: 0,
});
export type ReaderLayoutRegion = keyof ReaderLayoutProfile;
export const READER_LAYOUT_REGIONS = LAYOUT_KEYS;
export const READER_LAYOUT_MINIMUM_RATIOS = LAYOUT_MIN_RATIOS;

export const READER_FONT_DEFAULT = Object.freeze<ReaderFontProfile>({
	family: 'system',
	customFamily: '',
	weight: 400,
	interfaceColor: '',
	interface: 92,
	postFamily: 'system',
	postCustomFamily: '',
	postWeight: 400,
	postColor: '',
	post: 95,
	composerFamily: 'system',
	composerCustomFamily: '',
	composerWeight: 400,
	composerColor: '',
	composer: COMPOSER_FONT_SCALE_DEFAULT,
});
export const READER_FONT_FAMILIES = Object.freeze<
	readonly ReaderFontFamily[]
>([...FONT_FAMILIES]);
export const READER_FONT_WEIGHTS = Object.freeze<
	readonly ReaderFontWeight[]
>([...FONT_WEIGHTS]);
export const READER_FONT_SCALE_LIMITS = Object.freeze({
	min: FONT_SCALE_MIN,
	max: FONT_SCALE_MAX,
	step: 1,
});
export const READER_HOST_FONT_SCALE_LIMITS = Object.freeze({
	min: HOST_EMBED_SIZE_MIN,
	max: HOST_EMBED_SIZE_MAX,
	step: 1,
});
export const READER_HOST_FONT_SCALE_DEFAULTS = Object.freeze({
	title: 110,
	avatar: 80,
	stats: 120,
	labelCard: 100,
});
export const IMAGE_PROFILE_DEFAULT = Object.freeze<ReaderImageProfile>({
	preset: '100',
	custom: 100,
});
const APPEARANCE_PROFILE_DEFAULT = Object.freeze<ReaderAppearanceProfile>({
	accentColor: '#47855f',
	accentColorDark: '#78c295',
	linkColor: '#2870b8',
	linkColorDark: '#71b7ff',
	zebraColor: '#f7f7f7',
	zebraColorDark: '#1b2b21',
	zebraRadius: 10,
	listZebraColor: '#f7f7f7',
	listZebraColorDark: '#242a31',
	structureColorsEnabled: true,
	replyLineColor: '#6dab85',
	replyLineColorDark: '#78c295',
	replyLineWidth: 1,
	replyLineRadius: 15,
	quoteLineColor: '#d7d7d7',
	quoteLineColorDark: '#46505a',
	quoteLineWidth: 0.5,
	dividerLineColor: '#e5e5e5',
	dividerLineColorDark: '#343b44',
	dividerLineWidth: 0.5,
});
export const READER_APPEARANCE_DEFAULT = APPEARANCE_PROFILE_DEFAULT;
export const READER_APPEARANCE_COLOR_NAMES = Object.freeze<
	readonly ReaderAppearanceColorName[]
>([
	'accentColor',
	'linkColor',
	'zebraColor',
	'listZebraColor',
	'replyLineColor',
	'quoteLineColor',
	'dividerLineColor',
]);
export const READER_APPEARANCE_SETTING_NAMES = Object.freeze<
	readonly ReaderAppearanceSettingName[]
>([
	'accentColor',
	'linkColor',
	'zebraColor',
	'zebraRadius',
	'listZebraColor',
	'structureColorsEnabled',
	'replyLineColor',
	'replyLineWidth',
	'replyLineRadius',
	'quoteLineColor',
	'quoteLineWidth',
	'dividerLineColor',
	'dividerLineWidth',
]);
export const READER_APPEARANCE_NUMERIC_LIMITS = Object.freeze({
	zebraRadius: Object.freeze({ min: 0, max: 16, step: 1 }),
	replyLineWidth: Object.freeze({ min: 0.5, max: 4, step: 0.5 }),
	replyLineRadius: Object.freeze({ min: 0, max: 16, step: 1 }),
	quoteLineWidth: Object.freeze({ min: 0.5, max: 4, step: 0.5 }),
	dividerLineWidth: Object.freeze({ min: 0.5, max: 4, step: 0.5 }),
} satisfies Readonly<Record<
	Extract<ReaderAppearanceSettingName, `${string}Width` | `${string}Radius`>,
	Readonly<{ readonly min: number; readonly max: number; readonly step: number }>
>>);

interface ReaderAppearanceThemeLimit {
	readonly saturationMax: number;
	readonly light: readonly [number, number];
	readonly dark: readonly [number, number];
}

const READER_APPEARANCE_THEME_LIMITS = Object.freeze<
	Readonly<Record<ReaderAppearanceColorName, ReaderAppearanceThemeLimit>>
>({
	accentColor: Object.freeze({ saturationMax: 82, light: [30, 55] as const, dark: [58, 78] as const }),
	linkColor: Object.freeze({ saturationMax: 90, light: [30, 55] as const, dark: [60, 80] as const }),
	zebraColor: Object.freeze({ saturationMax: 70, light: [92, 100] as const, dark: [10, 20] as const }),
	listZebraColor: Object.freeze({ saturationMax: 38, light: [88, 98] as const, dark: [10, 20] as const }),
	replyLineColor: Object.freeze({ saturationMax: 76, light: [30, 58] as const, dark: [55, 78] as const }),
	quoteLineColor: Object.freeze({ saturationMax: 50, light: [72, 92] as const, dark: [22, 42] as const }),
	dividerLineColor: Object.freeze({ saturationMax: 40, light: [80, 94] as const, dark: [18, 34] as const }),
});

const PERFORMANCE_PRESETS = Object.freeze<
	Readonly<Record<Exclude<ReaderPerformancePreset, 'custom'>, ReaderPerformanceConfig>>
>({
	low: Object.freeze({
		pageSize: 24,
		streamOverscanViewports: 1,
		streamMaxItems: 48,
		nestedPrefetchViewports: 1.25,
		requestMaxConcurrent: 2,
		requestMinInterval: 180,
		requestRateTarget: 75,
	}),
	balanced: Object.freeze({
		pageSize: 48,
		streamOverscanViewports: 1.5,
		streamMaxItems: 80,
		nestedPrefetchViewports: 2.5,
		requestMaxConcurrent: 3,
		requestMinInterval: 100,
		requestRateTarget: 85,
	}),
	high: Object.freeze({
		pageSize: 64,
		streamOverscanViewports: 2,
		streamMaxItems: 96,
		nestedPrefetchViewports: 3,
		requestMaxConcurrent: 4,
		requestMinInterval: 80,
		requestRateTarget: 90,
	}),
});
const PERFORMANCE_NAMES = Object.freeze<readonly PerformanceName[]>([
	'pageSize',
	'streamOverscanViewports',
	'streamMaxItems',
	'nestedPrefetchViewports',
	'requestMaxConcurrent',
	'requestMinInterval',
	'requestRateTarget',
]);
const PERFORMANCE_LIMITS = Object.freeze<
	Readonly<Record<PerformanceName, NumericLimit>>
>({
	pageSize: Object.freeze({ min: 12, max: 64, integer: true }),
	streamOverscanViewports: Object.freeze({ min: 0.25, max: 3 }),
	streamMaxItems: Object.freeze({ min: 24, max: 128, integer: true }),
	nestedPrefetchViewports: Object.freeze({ min: 1, max: 3 }),
	requestMaxConcurrent: Object.freeze({ min: 1, max: 4, integer: true }),
	requestMinInterval: Object.freeze({ min: 80, max: 500, integer: true }),
	requestRateTarget: Object.freeze({ min: 50, max: 95, integer: true }),
});
export const READER_PERFORMANCE_PRESETS = PERFORMANCE_PRESETS;
export const READER_PERFORMANCE_LIMITS = PERFORMANCE_LIMITS;
export const READER_SHORTCUT_DEFAULTS = Object.freeze({
	historyBack: Object.freeze(['ArrowLeft', 'Mouse3']),
	historyForward: Object.freeze(['ArrowRight', 'Mouse4']),
	topicTop: Object.freeze(['Home']),
	topicBottom: Object.freeze(['End']),
	floorJump: Object.freeze<string[]>([]),
	discussionHorizontalScroll: Object.freeze(['Shift+Wheel']),
	onlyAuthor: Object.freeze<string[]>([]),
	translate: Object.freeze<string[]>([]),
	refreshTopic: Object.freeze<string[]>([]),
	refreshHost: Object.freeze(['F5']),
	openOriginal: Object.freeze<string[]>([]),
	settings: Object.freeze(['Ctrl+Comma']),
	notifications: Object.freeze<string[]>([]),
	historyPanel: Object.freeze<string[]>([]),
	bookmarksPanel: Object.freeze<string[]>([]),
	likeTopic: Object.freeze<string[]>([]),
	replyTopic: Object.freeze<string[]>([]),
	bookmarkTopic: Object.freeze<string[]>([]),
	toggleFullscreen: Object.freeze<string[]>([]),
	toggleQueue: Object.freeze<string[]>([]),
	closeReader: Object.freeze(['Escape']),
});

export const READER_SHORTCUT_ACTIONS = Object.freeze(
	Object.keys(READER_SHORTCUT_DEFAULTS) as ReaderShortcutAction[],
);
const SHORTCUT_MODIFIERS = Object.freeze(['Ctrl', 'Alt', 'Shift', 'Meta']);
const READER_SHORTCUT_RESERVED_BINDINGS = new Set([
	'Ctrl+KeyD',
	'Ctrl+KeyF',
	'Ctrl+KeyH',
	'Ctrl+KeyJ',
	'Ctrl+KeyL',
	'Ctrl+KeyN',
	'Ctrl+KeyO',
	'Ctrl+KeyP',
	'Ctrl+KeyR',
	'Ctrl+KeyS',
	'Ctrl+KeyT',
	'Ctrl+KeyW',
	'Ctrl+Tab',
	'Ctrl+Shift+KeyN',
	'Ctrl+Shift+KeyB',
	'Ctrl+Shift+KeyD',
	'Ctrl+Shift+KeyI',
	'Ctrl+Shift+KeyJ',
	'Ctrl+Shift+KeyO',
	'Ctrl+Shift+KeyP',
	'Ctrl+Shift+KeyT',
	'Ctrl+Shift+KeyW',
	'Ctrl+Shift+Delete',
	'Ctrl+Shift+Tab',
	'Ctrl+KeyU',
	'Alt+ArrowLeft',
	'Alt+ArrowRight',
	'Alt+F4',
	'Alt+Home',
	'Meta+Comma',
	'Meta+KeyF',
	'Meta+KeyL',
	'Meta+KeyN',
	'Meta+KeyP',
	'Meta+KeyQ',
	'Meta+KeyR',
	'Meta+KeyS',
	'Meta+KeyT',
	'Meta+KeyW',
	'Meta+BracketLeft',
	'Meta+BracketRight',
	'Alt+Meta+KeyC',
	'Alt+Meta+KeyI',
	'Alt+Meta+KeyJ',
	'Alt+Meta+ArrowLeft',
	'Alt+Meta+ArrowRight',
	'Shift+Meta+BracketLeft',
	'Shift+Meta+BracketRight',
	'Shift+Meta+KeyN',
	'Shift+Meta+KeyT',
	'Shift+Meta+KeyW',
	'F11',
	'F12',
]);

const READER_SHORTCUT_KEYBOARD_CODE = new RegExp([
	'^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|',
	'Arrow(?:Down|Left|Right|Up)|',
	'(?:Backquote|Backslash|BracketLeft|BracketRight|Comma|Equal|Minus|',
	'Period|Quote|Semicolon|Slash)|',
	'(?:Backspace|CapsLock|ContextMenu|Delete|End|Enter|Escape|Help|Home|',
	'Insert|PageDown|PageUp|Pause|PrintScreen|ScrollLock|Space|Tab)|',
	'Intl(?:Backslash|Ro|Yen)|Lang[1-5]|(?:Convert|KanaMode|NonConvert)|',
	'Numpad(?:[0-9]|Add|Backspace|Clear|ClearEntry|Comma|Decimal|Divide|',
	'Enter|Equal|Hash|MemoryAdd|MemoryClear|MemoryRecall|MemoryStore|',
	'MemorySubtract|Multiply|ParenLeft|ParenRight|Star|Subtract)|',
	'Browser(?:Back|Favorites|Forward|Home|Refresh|Search|Stop)|',
	'Media(?:PlayPause|Select|Stop|TrackNext|TrackPrevious)|',
	'AudioVolume(?:Down|Mute|Up)|Launch(?:App1|App2|Mail)|',
	'(?:Abort|Again|Copy|Cut|Eject|Find|Fn|FnLock|Hyper|Open|Paste|Power|',
	'Props|Select|Sleep|Super|Turbo|Undo|WakeUp))$',
].join(''));

const JUMP_HIGHLIGHT_DEFAULTS = Object.freeze({
	color: '#0888cc',
	radius: 10,
	borderWidth: 1,
	rate: 0.8,
	count: 1,
});
const JUMP_HIGHLIGHT_LIMITS = Object.freeze({
	radius: Object.freeze({ min: 0, max: 24, step: 1, integer: true }),
	borderWidth: Object.freeze({ min: 0, max: 4, step: 1, integer: true }),
	rate: Object.freeze({ min: 0.5, max: 2, step: 0.1, integer: false }),
	count: Object.freeze({ min: 1, max: 6, step: 1, integer: true }),
});
export const READER_JUMP_HIGHLIGHT_DEFAULTS = JUMP_HIGHLIGHT_DEFAULTS;
export const READER_JUMP_HIGHLIGHT_LIMITS = JUMP_HIGHLIGHT_LIMITS;

function finiteViewport(value: number, name: string): number {
	if (!Number.isFinite(value) || value < 0) {
		throw new RangeError(`${name} 必须是非负有限数`);
	}
	return value;
}

function plainRecord(value: unknown): Readonly<Record<string, unknown>> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>>
		: {};
}

function normalizeTopicActionRailPosition(
	value: unknown,
): ReaderTopicActionRailPosition {
	const source = plainRecord(value);
	const rawX = source.x;
	const numericX = Number(rawX);
	const x = rawX === 'left' || rawX === 'right'
		? rawX
		: Number.isFinite(numericX)
			? Math.max(0, Math.min(1, numericX))
			: 'left';
	const numericY = Number(source.y);
	return Object.freeze({
		x,
		y: Number.isFinite(numericY)
			? Math.max(0, Math.min(1, numericY))
			: 0.95,
	});
}

function normalizeTopicActionRailPositions(
	value: unknown,
	legacyValue: unknown,
): ReaderTopicActionRailPositions {
	const source = plainRecord(value);
	const legacy = normalizeTopicActionRailPosition(legacyValue);
	return Object.freeze({
		floating: Object.hasOwn(source, 'floating')
			? normalizeTopicActionRailPosition(source.floating)
			: legacy,
		fullpage: Object.hasOwn(source, 'fullpage')
			? normalizeTopicActionRailPosition(source.fullpage)
			: legacy,
		embedded: Object.hasOwn(source, 'embedded')
			? normalizeTopicActionRailPosition(source.embedded)
			: legacy,
	});
}

function roundedRange(
	value: unknown,
	fallback: number,
	minimum: number,
	maximum: number,
): number {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return fallback;
	return Math.min(maximum, Math.max(minimum, Math.round(numeric)));
}

function steppedRange(
	value: unknown,
	fallback: number,
	minimum: number,
	maximum: number,
	step: number,
): number {
	const numeric = Number(value);
	const safe = Number.isFinite(numeric) ? numeric : fallback;
	return Math.min(maximum, Math.max(minimum, Math.round(safe / step) * step));
}

function normalizeHexColor(value: unknown, fallback = ''): string {
	const color = String(value || '').trim().toLowerCase();
	if (/^#[0-9a-f]{6}$/.test(color)) return color;
	const fallbackColor = String(fallback || '').trim().toLowerCase();
	return /^#[0-9a-f]{6}$/.test(fallbackColor) ? fallbackColor : '';
}

function normalizeFontFamily(
	value: unknown,
	fallback: ReaderFontFamily,
): ReaderFontFamily {
	return FONT_FAMILIES.has(value as ReaderFontFamily)
		? value as ReaderFontFamily
		: fallback;
}

function normalizeCustomFontFamily(value: unknown, fallback = ''): string {
	const source = String(value == null ? fallback : value)
		.replace(/[\u0000-\u001f\u007f"'`,;{}<>\\]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	return [...source].slice(0, 64).join('');
}

function normalizeFontWeight(
	value: unknown,
	fallback: ReaderFontWeight,
): ReaderFontWeight {
	const numeric = Number(value) as ReaderFontWeight;
	return FONT_WEIGHTS.has(numeric) ? numeric : fallback;
}

export function normalizeImageProfile(value: unknown): ReaderImageProfile {
	const source = plainRecord(value);
	const sourcePreset = source.preset == null
		? IMAGE_PROFILE_DEFAULT.preset
		: source.preset;
	const preset = sourcePreset === 'custom'
		? 'custom'
		: IMAGE_SCALE_OPTIONS.includes(Number(sourcePreset))
			? String(Number(sourcePreset)) as ReaderImageProfile['preset']
			: '100';
	return Object.freeze({
		preset,
		custom: roundedRange(
			source.custom,
			IMAGE_PROFILE_DEFAULT.custom,
			IMAGE_SCALE_MIN,
			IMAGE_SCALE_MAX,
		),
	});
}

function normalizeFontProfile(value: unknown): ReaderFontProfile {
	const source = plainRecord(value);
	const family = normalizeFontFamily(source.family, READER_FONT_DEFAULT.family);
	const customFamily = normalizeCustomFontFamily(
		source.customFamily,
		READER_FONT_DEFAULT.customFamily,
	);
	const weight = normalizeFontWeight(source.weight, READER_FONT_DEFAULT.weight);
	return Object.freeze({
		family,
		customFamily,
		weight,
		interfaceColor: normalizeHexColor(
			source.interfaceColor,
			READER_FONT_DEFAULT.interfaceColor,
		),
		interface: roundedRange(
			source.interface,
			READER_FONT_DEFAULT.interface,
			FONT_SCALE_MIN,
			FONT_SCALE_MAX,
		),
		postFamily: normalizeFontFamily(source.postFamily, family),
		postCustomFamily: normalizeCustomFontFamily(source.postCustomFamily, customFamily),
		postWeight: normalizeFontWeight(source.postWeight, weight),
		postColor: normalizeHexColor(source.postColor, READER_FONT_DEFAULT.postColor),
		post: roundedRange(
			source.post,
			READER_FONT_DEFAULT.post,
			FONT_SCALE_MIN,
			FONT_SCALE_MAX,
		),
		composerFamily: normalizeFontFamily(source.composerFamily, family),
		composerCustomFamily: normalizeCustomFontFamily(
			source.composerCustomFamily,
			customFamily,
		),
		composerWeight: normalizeFontWeight(source.composerWeight, weight),
		composerColor: normalizeHexColor(
			source.composerColor,
			READER_FONT_DEFAULT.composerColor,
		),
		composer: roundedRange(
			source.composer,
			READER_FONT_DEFAULT.composer,
			FONT_SCALE_MIN,
			FONT_SCALE_MAX,
		),
	});
}

export function normalizeReaderFontProfile(value: unknown): ReaderFontProfile {
	return normalizeFontProfile(value);
}

function appearanceColorPair(
	source: Readonly<Record<string, unknown>>,
	key: keyof Pick<
		ReaderAppearanceProfile,
		| 'accentColor'
		| 'linkColor'
		| 'zebraColor'
		| 'listZebraColor'
		| 'replyLineColor'
		| 'quoteLineColor'
		| 'dividerLineColor'
	>,
): readonly [string, string] {
	const darkKey = `${key}Dark` as keyof ReaderAppearanceProfile;
	const lightFallback = normalizeHexColor(
		APPEARANCE_PROFILE_DEFAULT[key],
		APPEARANCE_PROFILE_DEFAULT[key],
	);
	const sourceColor = normalizeHexColor(source[key])
		|| normalizeHexColor(source[darkKey])
		|| lightFallback;
	return [sourceColor, sourceColor];
}

function normalizeAppearanceProfile(value: unknown): ReaderAppearanceProfile {
	const source = plainRecord(value);
	const [accentColor, accentColorDark] = appearanceColorPair(source, 'accentColor');
	const [linkColor, linkColorDark] = appearanceColorPair(source, 'linkColor');
	const [zebraColor, zebraColorDark] = appearanceColorPair(source, 'zebraColor');
	const [listZebraColor, listZebraColorDark] = appearanceColorPair(
		source,
		'listZebraColor',
	);
	const [replyLineColor, replyLineColorDark] = appearanceColorPair(
		source,
		'replyLineColor',
	);
	const [quoteLineColor, quoteLineColorDark] = appearanceColorPair(
		source,
		'quoteLineColor',
	);
	const [dividerLineColor, dividerLineColorDark] = appearanceColorPair(
		source,
		'dividerLineColor',
	);
	return Object.freeze({
		accentColor,
		accentColorDark,
		linkColor,
		linkColorDark,
		zebraColor,
		zebraColorDark,
		zebraRadius: steppedRange(source.zebraRadius, 10, 0, 16, 1),
		listZebraColor,
		listZebraColorDark,
		structureColorsEnabled: typeof source.structureColorsEnabled === 'boolean'
			? source.structureColorsEnabled
			: true,
		replyLineColor,
		replyLineColorDark,
		replyLineWidth: steppedRange(source.replyLineWidth, 1, 0.5, 4, 0.5),
		replyLineRadius: steppedRange(source.replyLineRadius, 15, 0, 16, 1),
		quoteLineColor,
		quoteLineColorDark,
		quoteLineWidth: steppedRange(source.quoteLineWidth, 0.5, 0.5, 4, 0.5),
		dividerLineColor,
		dividerLineColorDark,
		dividerLineWidth: steppedRange(source.dividerLineWidth, 0.5, 0.5, 4, 0.5),
	});
}

function hexColorToHsl(value: string): Readonly<{
	readonly hue: number;
	readonly saturation: number;
	readonly lightness: number;
}> | null {
	const color = normalizeHexColor(value);
	if (!color) return null;
	const [red, green, blue] = [1, 3, 5].map((index) =>
		Number.parseInt(color.slice(index, index + 2), 16) / 255,
	);
	const maximum = Math.max(red!, green!, blue!);
	const minimum = Math.min(red!, green!, blue!);
	const delta = maximum - minimum;
	const lightness = (maximum + minimum) / 2;
	const saturation = delta === 0
		? 0
		: delta / (1 - Math.abs(2 * lightness - 1));
	let hue = 0;
	if (delta !== 0) {
		if (maximum === red) hue = 60 * (((green! - blue!) / delta) % 6);
		else if (maximum === green) hue = 60 * ((blue! - red!) / delta + 2);
		else hue = 60 * ((red! - green!) / delta + 4);
	}
	return Object.freeze({
		hue: hue < 0 ? hue + 360 : hue,
		saturation: saturation * 100,
		lightness: lightness * 100,
	});
}

function hslColorToHex(
	hue: number,
	saturation: number,
	lightness: number,
): string {
	const normalizedHue = ((hue % 360) + 360) % 360;
	const normalizedSaturation = Math.min(100, Math.max(0, saturation)) / 100;
	const normalizedLightness = Math.min(100, Math.max(0, lightness)) / 100;
	const chroma =
		(1 - Math.abs(2 * normalizedLightness - 1)) *
		normalizedSaturation;
	const intermediate =
		chroma * (1 - Math.abs((normalizedHue / 60) % 2 - 1));
	const offset = normalizedLightness - chroma / 2;
	const sector = Math.floor(normalizedHue / 60);
	const channels = [
		[chroma, intermediate, 0],
		[intermediate, chroma, 0],
		[0, chroma, intermediate],
		[0, intermediate, chroma],
		[intermediate, 0, chroma],
		[chroma, 0, intermediate],
	][sector] ?? [0, 0, 0];
	return `#${channels.map((channel) =>
		Math.round((channel + offset) * 255)
			.toString(16)
			.padStart(2, '0'),
	).join('')}`;
}

export function normalizeReaderAppearanceProfile(
	value: unknown,
): ReaderAppearanceProfile {
	return normalizeAppearanceProfile(value);
}

export function readerAppearanceEditableProfile(
	profile: ReaderAppearanceProfile,
): ReaderAppearanceEditableProfile {
	return Object.freeze(Object.fromEntries(
		READER_APPEARANCE_SETTING_NAMES.map((name) => [name, profile[name]]),
	) as unknown as ReaderAppearanceEditableProfile);
}

export function resolveReaderAppearanceColor(
	profile: ReaderAppearanceProfile,
	name: ReaderAppearanceColorName,
	theme: ReaderAppearanceTheme,
): string {
	const darkName = `${name}Dark` as keyof ReaderAppearanceProfile;
	const defaultColor = theme === 'dark'
		? String(READER_APPEARANCE_DEFAULT[darkName])
		: String(READER_APPEARANCE_DEFAULT[name]);
	const sourceColor = normalizeHexColor(
		profile[name],
		READER_APPEARANCE_DEFAULT[name],
	);
	if (sourceColor === READER_APPEARANCE_DEFAULT[name]) return defaultColor;
	const hsl = hexColorToHsl(sourceColor);
	if (!hsl) return defaultColor;
	const limit = READER_APPEARANCE_THEME_LIMITS[name];
	const [minimumLightness, maximumLightness] = limit[theme];
	const saturation = Math.min(hsl.saturation, limit.saturationMax);
	const lightness = Math.min(
		maximumLightness,
		Math.max(minimumLightness, hsl.lightness),
	);
	if (
		Math.abs(saturation - hsl.saturation) < 0.01 &&
		Math.abs(lightness - hsl.lightness) < 0.01
	) return sourceColor;
	return hslColorToHex(hsl.hue, saturation, lightness);
}

function normalizePerformanceValue(
	name: PerformanceName,
	value: unknown,
	fallback: number,
): number {
	const limit = PERFORMANCE_LIMITS[name];
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return fallback;
	const clamped = Math.min(limit.max, Math.max(limit.min, numeric));
	return limit.integer ? Math.round(clamped) : Math.round(clamped * 100) / 100;
}

function performanceConfigFromInput(
	input: Readonly<Record<string, unknown>>,
): ReaderPerformanceConfig {
	const fallback = PERFORMANCE_PRESETS.balanced;
	return Object.freeze({
		pageSize: normalizePerformanceValue(
			'pageSize',
			input.performancePageSize,
			fallback.pageSize,
		),
		streamOverscanViewports: normalizePerformanceValue(
			'streamOverscanViewports',
			input.performanceStreamOverscan,
			fallback.streamOverscanViewports,
		),
		streamMaxItems: normalizePerformanceValue(
			'streamMaxItems',
			input.performanceStreamMaxItems,
			fallback.streamMaxItems,
		),
		nestedPrefetchViewports: normalizePerformanceValue(
			'nestedPrefetchViewports',
			input.performanceNestedPrefetch,
			fallback.nestedPrefetchViewports,
		),
		requestMaxConcurrent: normalizePerformanceValue(
			'requestMaxConcurrent',
			input.performanceRequestConcurrency,
			fallback.requestMaxConcurrent,
		),
		requestMinInterval: normalizePerformanceValue(
			'requestMinInterval',
			input.performanceRequestInterval,
			fallback.requestMinInterval,
		),
		requestRateTarget: normalizePerformanceValue(
			'requestRateTarget',
			input.performanceRequestRateTarget,
			fallback.requestRateTarget,
		),
	});
}

function performancePresetForConfig(
	config: ReaderPerformanceConfig,
): ReaderPerformancePreset {
	for (const preset of ['low', 'balanced', 'high'] as const) {
		if (PERFORMANCE_NAMES.every((name) =>
			config[name] === PERFORMANCE_PRESETS[preset][name])) {
			return preset;
		}
	}
	return 'custom';
}

function performancePreferencesPatch(
	config: ReaderPerformanceConfig,
	preset = performancePresetForConfig(config),
): Pick<
	ReaderPreferences,
	| 'performancePreset'
	| 'performancePageSize'
	| 'performanceStreamOverscan'
	| 'performanceStreamMaxItems'
	| 'performanceNestedPrefetch'
	| 'performanceRequestConcurrency'
	| 'performanceRequestInterval'
	| 'performanceRequestRateTarget'
> {
	return {
		performancePreset: preset,
		performancePageSize: config.pageSize,
		performanceStreamOverscan: config.streamOverscanViewports,
		performanceStreamMaxItems: config.streamMaxItems,
		performanceNestedPrefetch: config.nestedPrefetchViewports,
		performanceRequestConcurrency: config.requestMaxConcurrent,
		performanceRequestInterval: config.requestMinInterval,
		performanceRequestRateTarget: config.requestRateTarget,
	};
}

export function readReaderPerformanceConfig(
	input: Readonly<Partial<ReaderPreferences>>,
): ReaderPerformanceConfig {
	return performanceConfigFromInput(
		input as Readonly<Record<string, unknown>>,
	);
}

export function createReaderPerformancePreferencesPatch(
	config: ReaderPerformanceConfig,
	preset?: ReaderPerformancePreset,
): Pick<
	ReaderPreferences,
	| 'performancePreset'
	| 'performancePageSize'
	| 'performanceStreamOverscan'
	| 'performanceStreamMaxItems'
	| 'performanceNestedPrefetch'
	| 'performanceRequestConcurrency'
	| 'performanceRequestInterval'
	| 'performanceRequestRateTarget'
> {
	return performancePreferencesPatch(config, preset);
}

export function readerPerformancePresetForConfig(
	config: ReaderPerformanceConfig,
): ReaderPerformancePreset {
	return performancePresetForConfig(config);
}

function roundLayoutRatio(value: unknown): number {
	return Math.round(Number(value) * 100) / 100;
}

function layoutTotal(value: ReaderLayoutProfile): number {
	return roundLayoutRatio(LAYOUT_KEYS.reduce((sum, key) => sum + value[key], 0));
}

function normalizeLayoutProfile(
	value: unknown,
	fallback: ReaderLayoutProfile,
): ReaderLayoutProfile {
	const source = plainRecord(value);
	const result = Object.fromEntries(LAYOUT_KEYS.map((key) => {
		const numeric = Number(source[key]);
		const safe = Number.isFinite(numeric) ? numeric : fallback[key];
		return [
			key,
			roundLayoutRatio(Math.min(100, Math.max(LAYOUT_MIN_RATIOS[key], safe))),
		];
	})) as unknown as Record<keyof ReaderLayoutProfile, number>;
	if (layoutTotal(result) > 100) {
		const minimumTotal = LAYOUT_KEYS.reduce(
			(sum, key) => sum + LAYOUT_MIN_RATIOS[key],
			0,
		);
		const extraBudget = 100 - minimumTotal;
		const extras = Object.fromEntries(LAYOUT_KEYS.map((key) => [
			key,
			Math.max(0, result[key] - LAYOUT_MIN_RATIOS[key]),
		])) as unknown as Record<keyof ReaderLayoutProfile, number>;
		const extraTotal = LAYOUT_KEYS.reduce((sum, key) => sum + extras[key], 0) || 1;
		for (const key of LAYOUT_KEYS) {
			result[key] = roundLayoutRatio(
				LAYOUT_MIN_RATIOS[key] + extraBudget * extras[key] / extraTotal,
			);
		}
		let overflow = roundLayoutRatio(layoutTotal(result) - 100);
		if (overflow > 0) {
			const correctionKey = LAYOUT_KEYS.find(
				(key) => result[key] - overflow >= LAYOUT_MIN_RATIOS[key],
			);
			if (correctionKey) {
				result[correctionKey] = roundLayoutRatio(result[correctionKey] - overflow);
			}
			overflow = roundLayoutRatio(layoutTotal(result) - 100);
			if (overflow > 0) result.main = roundLayoutRatio(result.main - overflow);
		}
	}
	return Object.freeze({ ...result });
}

export function readerLayoutProfileTotal(
	profile: ReaderLayoutProfile,
): number {
	return layoutTotal(profile);
}

export function readerLayoutRegionMaximum(
	region: ReaderLayoutRegion,
): number {
	return roundLayoutRatio(
		100 - LAYOUT_KEYS.reduce(
			(total, name) =>
				total + (name === region ? 0 : LAYOUT_MIN_RATIOS[name]),
			0,
		),
	);
}

export function rebalanceReaderLayoutProfile(
	profile: ReaderLayoutProfile,
	editedRegion: ReaderLayoutRegion,
): ReaderLayoutProfile {
	const result = { ...profile };
	const difference = roundLayoutRatio(100 - layoutTotal(result));
	const direction = difference > 0 ? 1 : -1;
	let remaining = Math.abs(difference);
	for (const name of [
		'main',
		'left',
		'right',
		'gap',
		'timeline',
	] as const) {
		if (name === editedRegion || remaining <= 0) continue;
		const capacity = roundLayoutRatio(
			direction > 0
				? 100 - result[name]
				: Math.max(0, result[name] - LAYOUT_MIN_RATIOS[name]),
		);
		const change = Math.min(capacity, remaining);
		result[name] = roundLayoutRatio(
			result[name] + direction * change,
		);
		remaining = roundLayoutRatio(remaining - change);
	}
	return normalizeLayoutProfile(result, profile);
}

function normalizeReaderWindowGroup(
	source: Readonly<Record<string, unknown>>,
): Pick<
	ReaderPreferences,
	| 'readerWindowWidth'
	| 'readerWindowHeight'
	| 'readerWindowX'
	| 'readerWindowY'
	| 'readerWindowLocked'
	| 'readerWindowPinned'
> {
	const width = Number(source.readerWindowWidth);
	const height = Number(source.readerWindowHeight);
	const x = Number(source.readerWindowX);
	const y = Number(source.readerWindowY);
	return {
		readerWindowWidth: Number.isFinite(width) && width > 0
			? Math.max(READER_WINDOW_MIN_WIDTH, Math.round(width))
			: 0,
		readerWindowHeight: Number.isFinite(height) && height > 0
			? Math.max(READER_WINDOW_MIN_HEIGHT, Math.round(height))
			: 0,
		readerWindowX: Number.isFinite(x) && x > 0 ? Math.round(x) : 0,
		readerWindowY: Number.isFinite(y) && y > 0 ? Math.round(y) : 0,
		readerWindowLocked: Boolean(source.readerWindowLocked),
		readerWindowPinned: Boolean(source.readerWindowPinned),
	};
}

function normalizeComposerWindowGroup(
	source: Readonly<Record<string, unknown>>,
): Pick<
	ReaderPreferences,
	| 'composerWindowWidth'
	| 'composerWindowHeight'
	| 'composerWindowX'
	| 'composerWindowY'
> {
	const result = {} as Record<
		| 'composerWindowWidth'
		| 'composerWindowHeight'
		| 'composerWindowX'
		| 'composerWindowY',
		number
	>;
	for (const key of [
		'composerWindowWidth',
		'composerWindowHeight',
		'composerWindowX',
		'composerWindowY',
	] as const) {
		const value = Number(source[key]);
		result[key] = Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
	}
	return result;
}

export function normalizeReaderShortcutBinding(value: unknown): string {
	const parts = String(value || '')
		.split('+')
		.map((part) => part.trim())
		.filter(Boolean);
	const code = parts.pop() || '';
	if (
		!READER_SHORTCUT_KEYBOARD_CODE.test(code) &&
		!/^Mouse(?:1|3|4|[5-9])$/.test(code) &&
		code !== 'Wheel'
		|| /^(?:Control|Alt|Shift|Meta)(?:Left|Right)?$/.test(code)
	) {
		return '';
	}
	const modifiers = SHORTCUT_MODIFIERS.filter((modifier) => parts.includes(modifier));
	if (parts.some((part) => !SHORTCUT_MODIFIERS.includes(part))) return '';
	return [...modifiers, code].join('+');
}

export function readerShortcutBindingPolicyIssue(
	value: unknown,
): 'invalid' | 'reserved' | 'bare-alphanumeric' | null {
	const binding = normalizeReaderShortcutBinding(value);
	if (!binding) return 'invalid';
	if (READER_SHORTCUT_RESERVED_BINDINGS.has(binding)) return 'reserved';
	const parts = binding.split('+');
	const code = parts.at(-1) ?? '';
	return parts.length === 1 &&
		/^(?:Key[A-Z]|Digit\d|Numpad\d)$/.test(code)
		? 'bare-alphanumeric'
		: null;
}

export function normalizeReaderShortcutBindings(
	value: unknown,
): ReaderShortcutBindings {
	const source = plainRecord(value);
	const used = new Set<string>();
	const result = {} as Record<ReaderShortcutAction, readonly string[]>;
	for (const action of READER_SHORTCUT_ACTIONS) {
		const selected = Object.hasOwn(source, action) && Array.isArray(source[action])
			? source[action]
			: READER_SHORTCUT_DEFAULTS[action];
		const bindings = [...new Set(
			selected.map(normalizeReaderShortcutBinding).filter((binding) =>
				binding && readerShortcutBindingPolicyIssue(binding) === null),
		)].filter((binding) => {
			if (used.has(binding)) return false;
			used.add(binding);
			return true;
		}).slice(0, 3);
		result[action] = Object.freeze(bindings);
	}
	return Object.freeze(result);
}

function normalizeBookmarkTabOrder(value: unknown): readonly BookmarkTabType[] {
	const stored = Array.isArray(value)
		? [...new Set(value.filter(
			(type): type is BookmarkTabType =>
				BOOKMARK_TAB_TYPES.includes(type as BookmarkTabType),
		))]
		: [];
	return Object.freeze([
		...stored,
		...BOOKMARK_TAB_TYPES.filter((type) => !stored.includes(type)),
	]);
}

function normalizeJumpValue(
	name: keyof typeof JUMP_HIGHLIGHT_LIMITS,
	value: unknown,
): number {
	const limit = JUMP_HIGHLIGHT_LIMITS[name];
	const fallback = JUMP_HIGHLIGHT_DEFAULTS[name];
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return fallback;
	const clamped = Math.min(limit.max, Math.max(limit.min, numeric));
	if (limit.integer) return Math.round(clamped);
	return Math.round(Math.round(clamped / limit.step) * limit.step * 100) / 100;
}

function normalizeBoostPreferences(
	source: Readonly<Record<string, unknown>>,
): Pick<
	ReaderPreferences,
	| 'boostCopyMode'
	| 'boostCopyPrefix'
	| 'boostCopyCounterMarker'
	| 'boostCopyCounterStep'
	| 'boostCopyFixedSuffix'
> {
	const normalized = normalizeBoostCopySettings({
		mode: source.boostCopyMode === 'text' ? 'text' : 'counter',
		prefix: String(source.boostCopyPrefix ?? ''),
		counterMarker: String(source.boostCopyCounterMarker ?? ''),
		counterStep: Number(source.boostCopyCounterStep),
		fixedSuffix: String(source.boostCopyFixedSuffix ?? ''),
	});
	return {
		boostCopyMode: normalized.mode,
		boostCopyPrefix: normalized.prefix,
		boostCopyCounterMarker: normalized.counterMarker,
		boostCopyCounterStep: normalized.counterStep,
		boostCopyFixedSuffix: normalized.fixedSuffix,
	};
}

function normalizeEnvironment(
	environment: ReaderPreferencesEnvironment,
): ReaderPreferencesEnvironment {
	return Object.freeze({
		viewportWidth: finiteViewport(environment.viewportWidth, 'viewportWidth'),
		viewportHeight: finiteViewport(environment.viewportHeight, 'viewportHeight'),
	});
}

export function createReaderPreferencesDefaults(
	environment: ReaderPreferencesEnvironment,
): Readonly<ReaderPreferences> {
	const viewport = normalizeEnvironment(environment);
	const performance = performancePreferencesPatch(
		PERFORMANCE_PRESETS.balanced,
		'balanced',
	);
	return Object.freeze({
		topicReaderMode: 'fullpage',
		imageProfile: IMAGE_PROFILE_DEFAULT,
		imageProfilesShared: true,
		floatingImageProfile: IMAGE_PROFILE_DEFAULT,
		fullpageImageProfile: IMAGE_PROFILE_DEFAULT,
		mobileImageProfile: IMAGE_PROFILE_DEFAULT,
		lightboxOriginalByDefault: true,
		lightboxCommentsExpandedByDefault: true,
		lightboxDescriptionExpanded: false,
		lightboxDescriptionHeight: LIGHTBOX_DESCRIPTION_HEIGHT_DEFAULT,
		lightboxCommentsWidthPercent: LIGHTBOX_COMMENTS_WIDTH_DEFAULT,
		themeMode: 'system',
		autoDarkModeEnabled: false,
		autoDarkModeStartTime: 'sunset',
		fontRenderingEnabled: true,
		fontRenderingOnHost: true,
		hostFontFamily: 'system',
		hostFontCustomFamily: '',
		hostFontWeight: 400,
		hostFontColor: '',
		hostEmbeddedTitleScale: READER_HOST_FONT_SCALE_DEFAULTS.title,
		hostEmbeddedAvatarScale: READER_HOST_FONT_SCALE_DEFAULTS.avatar,
		hostEmbeddedStatsScale: READER_HOST_FONT_SCALE_DEFAULTS.stats,
		hostEmbeddedLabelCardScale:
			READER_HOST_FONT_SCALE_DEFAULTS.labelCard,
		fontProfile: READER_FONT_DEFAULT,
		appearanceProfile: APPEARANCE_PROFILE_DEFAULT,
		...performance,
		layoutProfile: READER_LAYOUT_DEFAULT,
		fullpageLayoutProfile: READER_FULLPAGE_LAYOUT_DEFAULT,
		readerWindowWidth: 0,
		readerWindowHeight: 0,
		readerWindowX: 0,
		readerWindowY: 0,
		readerWindowLocked: false,
		readerWindowPinned: false,
		listReaderMode: 'embed-right',
		listReaderEmbedWidth: Math.round(viewport.viewportWidth * 0.45),
		composerWindowWidth: 0,
		composerWindowHeight: 0,
		composerWindowX: 0,
		composerWindowY: 0,
		historySortMode: 'recent-viewed',
		bookmarkTabOrder: BOOKMARK_TAB_TYPES,
		historyButtonsAlwaysVisible: true,
		readerQueueAlwaysVisibleWhenEmpty: true,
		historyEdgeTriggerPercent: HISTORY_EDGE_TRIGGER_DEFAULT,
		loadingAnimation: 'quoteecho',
		translationMode: 'original',
		translationTheme: DEFAULT_READER_TRANSLATION_THEME,
		openTopicsAtFirstPost: true,
		doubleEscapeToCloseReader: false,
		confirmNativeComposerClose: false,
		readerShortcutBindings:
			normalizeReaderShortcutBindings(READER_SHORTCUT_DEFAULTS),
		topicActionRailVisible: true,
		topicActionRailFixed: false,
		topicActionRailMode: 'compact',
		topicActionRailPositions: Object.freeze({
			floating: Object.freeze({ x: 'left', y: 0.95 }),
			fullpage: Object.freeze({ x: 'left', y: 0.95 }),
			embedded: Object.freeze({ x: 'left', y: 0.95 }),
		}),
		unwantedTopicFilterEnabled: false,
		unwantedTopicFilterCategories: Object.freeze([]),
		unwantedTopicFilterLabels: Object.freeze([]),
		unwantedTopicFilterTopicAuthors: Object.freeze([]),
		unwantedTopicFilterTopicFields: Object.freeze([]),
		unwantedTopicFilterPostAuthors: Object.freeze([]),
		expandNestedRepliesByDefault: true,
		expandLeafNestedReplies: false,
		aggregateDescendantReplies: true,
		inlineReplyTreeMaxDepth: INLINE_REPLY_TREE_DEFAULT_DEPTH,
		hideNestedReplyFloors: true,
		jumpHighlightColor: JUMP_HIGHLIGHT_DEFAULTS.color,
		jumpHighlightRadius: JUMP_HIGHLIGHT_DEFAULTS.radius,
		jumpHighlightBorderWidth: JUMP_HIGHLIGHT_DEFAULTS.borderWidth,
		jumpHighlightRate: JUMP_HIGHLIGHT_DEFAULTS.rate,
		jumpHighlightCount: JUMP_HIGHLIGHT_DEFAULTS.count,
		boostCopyMode: DEFAULT_BOOST_COPY_SETTINGS.mode,
		boostCopyPrefix: DEFAULT_BOOST_COPY_SETTINGS.prefix,
		boostCopyCounterMarker:
			DEFAULT_BOOST_COPY_SETTINGS.counterMarker,
		boostCopyCounterStep: DEFAULT_BOOST_COPY_SETTINGS.counterStep,
		boostCopyFixedSuffix: DEFAULT_BOOST_COPY_SETTINGS.fixedSuffix,
	});
}

/**
 * 全局恢复默认只重置普通阅读器偏好。用户在“不想再看”内维护的自动过滤规则
 * 属于持久内容，与独立仓储中的手动免打扰 Topic 一样保留。
 */
export function createReaderPreferencesResetValue(
	defaults: Readonly<ReaderPreferences>,
	current: Readonly<ReaderPreferences>,
): Readonly<ReaderPreferences> {
	return Object.freeze({
		...defaults,
		...readerPreferencesUnwantedTopicFilterAdapter.createPatch(
			readerPreferencesUnwantedTopicFilterAdapter.read(current),
		),
	});
}

/**
 * 旧版 readPrefs 的存储入口语义：已命名的性能预设覆盖七个存储字段；
 * 普通 update/replace 不调用它，避免把用户刚调的单项值重新覆盖。
 */
export function prepareStoredReaderPreferences(
	value: unknown,
): Readonly<Record<string, unknown>> {
	const source = { ...plainRecord(value) };
	const preset = source.performancePreset;
	if (preset === 'low' || preset === 'balanced' || preset === 'high') {
		const patch = performancePreferencesPatch(PERFORMANCE_PRESETS[preset], preset);
		return Object.freeze({ ...source, ...patch });
	}
	return Object.freeze(source);
}

export function normalizeReaderPreferences(
	value: Readonly<Record<string, unknown>>,
	environment: ReaderPreferencesEnvironment,
): Readonly<ReaderPreferences> {
	const viewport = normalizeEnvironment(environment);
	const defaults = createReaderPreferencesDefaults(viewport);
	const known = Object.fromEntries(
		Object.keys(defaults)
			.filter((key) => Object.hasOwn(value, key))
			.map((key) => [key, value[key]]),
	);
	const source = { ...defaults, ...known };
	const performance = performancePreferencesPatch(performanceConfigFromInput(source));
	const expandLeafNestedReplies = source.expandLeafNestedReplies === true;
	const aggregateDescendantReplies = source.aggregateDescendantReplies === true;
	const expandNestedRepliesByDefault = aggregateDescendantReplies
		|| (source.expandNestedRepliesByDefault !== false || !expandLeafNestedReplies);
	const windowPreferences = normalizeReaderWindowGroup(source);
	const composerPreferences = normalizeComposerWindowGroup(source);
	const boostPreferences = normalizeBoostPreferences(source);
	const lightboxMaximum = Math.max(
		LIGHTBOX_DESCRIPTION_HEIGHT_MIN,
		Math.floor(viewport.viewportHeight * 0.4),
	);
	const lightboxHeight = Math.round(Number(source.lightboxDescriptionHeight));
	const listWidth = Number(source.listReaderEmbedWidth);
	const historyEdge = Number(source.historyEdgeTriggerPercent);
	const depth = Number.parseInt(String(source.inlineReplyTreeMaxDepth), 10);
	const loadingAnimation = source.loadingAnimation === 'random'
		|| READER_LOADING_ANIMATIONS.has(source.loadingAnimation as ReaderLoadingAnimation)
		? source.loadingAnimation as ReaderLoadingAnimation
		: 'quoteecho';
	const topicReaderMode = source.topicReaderMode === 'floating'
		? 'floating'
		: 'fullpage';
	const imageProfile = normalizeImageProfile(source.imageProfile);
	const imageProfilesShared = source.imageProfilesShared !== false;
	const floatingImageProfile = imageProfilesShared
		? imageProfile
		: normalizeImageProfile(
			source.floatingImageProfile ?? imageProfile,
		);
	const fullpageImageProfile = imageProfilesShared
		? imageProfile
		: normalizeImageProfile(
			source.fullpageImageProfile ?? imageProfile,
		);
	const mobileImageProfile = imageProfilesShared
		? imageProfile
		: normalizeImageProfile(
			source.mobileImageProfile ?? imageProfile,
		);
	const listReaderMode = [
		'floating',
		'fullpage',
		'embed-left',
		'embed-right',
	].includes(String(source.listReaderMode))
		? source.listReaderMode as ReaderPreferences['listReaderMode']
		: defaults.listReaderMode;
	const themeMode = ['light', 'dark', 'system'].includes(String(source.themeMode))
		? source.themeMode as ReaderPreferences['themeMode']
		: 'system';
	const autoDarkModeStartTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(
		String(source.autoDarkModeStartTime),
	)
		? String(source.autoDarkModeStartTime)
		: 'sunset';
	const translationMode = ['bilingual', 'translation'].includes(
		String(source.translationMode),
	)
		? source.translationMode as ReaderPreferences['translationMode']
		: 'original';
	const translationTheme = normalizeReaderTranslationTheme(
		source.translationTheme,
	);
	const jumpColor = String(source.jumpHighlightColor || '').trim().toLowerCase();
	const unwantedTopicFilter = normalizeReaderUnwantedTopicFilterPreferences({
		enabled: source.unwantedTopicFilterEnabled === true,
		categories: source.unwantedTopicFilterCategories as readonly string[],
		labels: source.unwantedTopicFilterLabels as readonly string[],
		topicAuthors: source.unwantedTopicFilterTopicAuthors as readonly string[],
		topicFields: source.unwantedTopicFilterTopicFields as readonly string[],
		postAuthors: source.unwantedTopicFilterPostAuthors as readonly string[],
	});
	return Object.freeze({
		topicReaderMode,
		imageProfile,
		imageProfilesShared,
		floatingImageProfile,
		fullpageImageProfile,
		mobileImageProfile,
		lightboxOriginalByDefault: source.lightboxOriginalByDefault === true,
		lightboxCommentsExpandedByDefault:
			source.lightboxCommentsExpandedByDefault === true,
		lightboxDescriptionExpanded: source.lightboxDescriptionExpanded === true,
		lightboxDescriptionHeight: Math.min(
			lightboxMaximum,
			Math.max(
				LIGHTBOX_DESCRIPTION_HEIGHT_MIN,
				Number.isFinite(lightboxHeight)
					? lightboxHeight
					: LIGHTBOX_DESCRIPTION_HEIGHT_DEFAULT,
			),
		),
		lightboxCommentsWidthPercent: Math.min(
			LIGHTBOX_COMMENTS_WIDTH_MAX,
			Math.max(
				LIGHTBOX_COMMENTS_WIDTH_MIN,
				Number.isFinite(Number(source.lightboxCommentsWidthPercent))
					? Number(source.lightboxCommentsWidthPercent)
					: LIGHTBOX_COMMENTS_WIDTH_DEFAULT,
			),
		),
		themeMode,
		autoDarkModeEnabled: source.autoDarkModeEnabled === true,
		autoDarkModeStartTime,
		fontRenderingEnabled: source.fontRenderingEnabled !== false,
		fontRenderingOnHost: source.fontRenderingOnHost === true,
		hostFontFamily: normalizeFontFamily(source.hostFontFamily, 'system'),
		hostFontCustomFamily: normalizeCustomFontFamily(source.hostFontCustomFamily),
		hostFontWeight: normalizeFontWeight(source.hostFontWeight, 400),
		hostFontColor: normalizeHexColor(source.hostFontColor),
		hostEmbeddedTitleScale: roundedRange(
			source.hostEmbeddedTitleScale,
			READER_HOST_FONT_SCALE_DEFAULTS.title,
			HOST_EMBED_SIZE_MIN,
			HOST_EMBED_SIZE_MAX,
		),
		hostEmbeddedAvatarScale: roundedRange(
			source.hostEmbeddedAvatarScale,
			READER_HOST_FONT_SCALE_DEFAULTS.avatar,
			HOST_EMBED_SIZE_MIN,
			HOST_EMBED_SIZE_MAX,
		),
		hostEmbeddedStatsScale: roundedRange(
			source.hostEmbeddedStatsScale,
			READER_HOST_FONT_SCALE_DEFAULTS.stats,
			HOST_EMBED_SIZE_MIN,
			HOST_EMBED_SIZE_MAX,
		),
		hostEmbeddedLabelCardScale: roundedRange(
			source.hostEmbeddedLabelCardScale,
			READER_HOST_FONT_SCALE_DEFAULTS.labelCard,
			HOST_EMBED_SIZE_MIN,
			HOST_EMBED_SIZE_MAX,
		),
		fontProfile: normalizeFontProfile(source.fontProfile),
		appearanceProfile: normalizeAppearanceProfile(source.appearanceProfile),
		...performance,
		layoutProfile: normalizeLayoutProfile(source.layoutProfile, READER_LAYOUT_DEFAULT),
		fullpageLayoutProfile: normalizeLayoutProfile(
			source.fullpageLayoutProfile,
			READER_FULLPAGE_LAYOUT_DEFAULT,
		),
		...windowPreferences,
		listReaderMode,
		listReaderEmbedWidth: Number.isFinite(listWidth)
			? Math.max(READER_EMBED_MIN_WIDTH, Math.round(listWidth))
			: defaults.listReaderEmbedWidth,
		...composerPreferences,
		historySortMode: source.historySortMode === 'first-viewed'
			? 'first-viewed'
			: 'recent-viewed',
		bookmarkTabOrder: normalizeBookmarkTabOrder(source.bookmarkTabOrder),
		historyButtonsAlwaysVisible: source.historyButtonsAlwaysVisible === true,
		readerQueueAlwaysVisibleWhenEmpty:
			source.readerQueueAlwaysVisibleWhenEmpty !== false,
		historyEdgeTriggerPercent: Number.isFinite(historyEdge)
			? Math.min(
				HISTORY_EDGE_TRIGGER_MAX,
				Math.max(HISTORY_EDGE_TRIGGER_MIN, Math.round(historyEdge)),
			)
			: HISTORY_EDGE_TRIGGER_DEFAULT,
		loadingAnimation,
		translationMode,
		translationTheme,
		openTopicsAtFirstPost: source.openTopicsAtFirstPost !== false,
		doubleEscapeToCloseReader: source.doubleEscapeToCloseReader === true,
		confirmNativeComposerClose: source.confirmNativeComposerClose === true,
		readerShortcutBindings:
			normalizeReaderShortcutBindings(source.readerShortcutBindings),
		topicActionRailVisible: source.topicActionRailVisible !== false,
		topicActionRailFixed: source.topicActionRailFixed === true,
		topicActionRailMode: source.topicActionRailMode === 'collapsed'
			? 'collapsed'
			: 'compact',
		topicActionRailPositions: normalizeTopicActionRailPositions(
			Object.hasOwn(value, 'topicActionRailPositions')
				? source.topicActionRailPositions
				: null,
			value.topicActionRailPosition,
		),
		unwantedTopicFilterEnabled: unwantedTopicFilter.enabled,
		unwantedTopicFilterCategories: unwantedTopicFilter.categories,
		unwantedTopicFilterLabels: unwantedTopicFilter.labels,
		unwantedTopicFilterTopicAuthors: unwantedTopicFilter.topicAuthors,
		unwantedTopicFilterTopicFields: unwantedTopicFilter.topicFields,
		unwantedTopicFilterPostAuthors: unwantedTopicFilter.postAuthors,
		expandNestedRepliesByDefault,
		expandLeafNestedReplies,
		aggregateDescendantReplies,
		inlineReplyTreeMaxDepth: Math.min(
			INLINE_REPLY_TREE_MAX_DEPTH,
			Math.max(1, depth || INLINE_REPLY_TREE_DEFAULT_DEPTH),
		),
		hideNestedReplyFloors: source.hideNestedReplyFloors === true,
		jumpHighlightColor: /^#[0-9a-f]{6}$/.test(jumpColor)
			? jumpColor
			: JUMP_HIGHLIGHT_DEFAULTS.color,
		jumpHighlightRadius: normalizeJumpValue('radius', source.jumpHighlightRadius),
		jumpHighlightBorderWidth: normalizeJumpValue(
			'borderWidth',
			source.jumpHighlightBorderWidth,
		),
		jumpHighlightRate: normalizeJumpValue('rate', source.jumpHighlightRate),
		jumpHighlightCount: normalizeJumpValue('count', source.jumpHighlightCount),
		...boostPreferences,
	});
}

export interface ReaderPreferencesConfigCodecOptions {
	readonly environment: ReaderPreferencesEnvironment;
	readonly scriptVersion: string;
	readonly now?: () => Date;
}

export function createReaderPreferencesConfigCodec(
	options: ReaderPreferencesConfigCodecOptions,
): PreferencesConfigCodec<ReaderPreferences> {
	const defaults = createReaderPreferencesDefaults(options.environment);
	const normalize = (
		value: Readonly<Record<string, unknown>>,
	): Readonly<ReaderPreferences> =>
		normalizeReaderPreferences(value, options.environment);
	const unwantedTopicFilterDefaults = Object.freeze({
		unwantedTopicFilterEnabled: false,
		unwantedTopicFilterCategories: Object.freeze([]),
		unwantedTopicFilterLabels: Object.freeze([]),
		unwantedTopicFilterTopicAuthors: Object.freeze([]),
		unwantedTopicFilterTopicFields: Object.freeze([]),
		unwantedTopicFilterPostAuthors: Object.freeze([]),
	});
	return new PreferencesConfigCodec({
		format: READER_CONFIG_EXPORT_FORMAT,
		schemaVersion: READER_CONFIG_EXPORT_VERSION,
		scriptVersion: options.scriptVersion,
		defaults,
		normalize,
		legacyImportRules: [
			{
				missingDefaults: unwantedTopicFilterDefaults,
			},
			{
				missingDefaults: {
					...unwantedTopicFilterDefaults,
					autoDarkModeEnabled: false,
					autoDarkModeStartTime: 'sunset',
				},
			},
			{
				missingDefaults: {
					...unwantedTopicFilterDefaults,
					autoDarkModeEnabled: false,
					autoDarkModeStartTime: 'sunset',
					fullpageLayoutProfile: READER_FULLPAGE_LAYOUT_DEFAULT,
				},
			},
			{
				missingDefaults: {
					...unwantedTopicFilterDefaults,
					autoDarkModeEnabled: false,
					autoDarkModeStartTime: 'sunset',
					fullpageLayoutProfile: READER_FULLPAGE_LAYOUT_DEFAULT,
					confirmNativeComposerClose: true,
				},
			},
			{
				missingDefaults: {
					...unwantedTopicFilterDefaults,
					autoDarkModeEnabled: false,
					autoDarkModeStartTime: 'sunset',
					readerShortcutBindings: defaults.readerShortcutBindings,
					topicActionRailMode: 'compact',
					inlineReplyTreeMaxDepth: 1,
				},
			},
		],
		...(options.now ? { now: options.now } : {}),
	});
}

export interface ReaderPreferencesRepositoryOptions {
	readonly environment: ReaderPreferencesEnvironment;
	readonly storage: PreferenceStoragePort;
}

export function createReaderPreferencesRepository(
	options: ReaderPreferencesRepositoryOptions,
): PreferencesRepository<ReaderPreferences> {
	const defaults = createReaderPreferencesDefaults(options.environment);
	return new PreferencesRepository({
		key: READER_PREFERENCES_STORAGE_KEY,
		storage: options.storage,
		defaults,
		normalize: (value) => normalizeReaderPreferences(value, options.environment),
		prepareStored: prepareStoredReaderPreferences,
	});
}
