import { parseHTML } from 'linkedom';
import {
	ReaderAppearanceStyleController,
	readerPreferencesAppearanceAdapter,
} from '../src/appearance/reader-appearance-style-controller.js';
import { Signal } from '../src/kernel/signal.js';
import {
	ReaderAppearanceSettingsForm,
} from '../src/settings/reader-appearance-settings-form.js';
import {
	ReaderSettingsController,
} from '../src/settings/reader-settings-controller.js';
import type {
	EmbeddedHostResolvedAppearance,
} from '../src/shell/embedded-host-appearance.js';
import {
	createReaderPreferencesDefaults,
	type ReaderPreferences,
} from '../src/state/reader-preferences-schema.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body>' +
	'<main id="root" class="ldp-structure-colors-disabled" ' +
	'style="--tertiary:#010203!important"></main>' +
	'<section id="host"></section></body></html>',
);
const document = parsedDocument as unknown as Document;
const root = document.querySelector<HTMLElement>('#root')!;
const host = document.querySelector<HTMLElement>('#host')!;
const preferenceChanges = new Signal<Readonly<ReaderPreferences>>();
const environmentChanges = new Signal<EmbeddedHostResolvedAppearance>();
let preferences = createReaderPreferencesDefaults({
	viewportWidth: 1_440,
	viewportHeight: 900,
});
let environment: EmbeddedHostResolvedAppearance = Object.freeze({
	profile: preferences.appearanceProfile,
	theme: 'light',
	defaultDividerLineColor: '#d0d0d0',
	defaultDividerLineWidth: 1,
});
let updateCount = 0;
const settings = new ReaderSettingsController<ReaderPreferences>({
	preferences: {
		read: () => preferences,
		update(patch) {
			updateCount += 1;
			preferences = Object.freeze({ ...preferences, ...patch });
			preferenceChanges.emit(preferences);
			return preferences;
		},
	},
	initialPanelId: 'appearance',
});
const appearance = new ReaderAppearanceStyleController({
	root,
	preferences: readerPreferencesAppearanceAdapter,
	readPreferences: () => preferences,
	preferenceChanges,
	environment: {
		read: () => environment,
		subscribe: (listener, scope) =>
			environmentChanges.subscribe(listener, scope),
	},
});
let appearanceChanges = 0;
appearance.changes.subscribe(() => {
	appearanceChanges += 1;
});
const form = new ReaderAppearanceSettingsForm({
	document,
	host,
	controller: settings,
	appearance,
});

assert(
	host.querySelectorAll('[data-appearance-setting]').length === 13 &&
	[...host.querySelectorAll('.ldp-color-group-title')]
		.map((node) => node.textContent).join('|') ===
		'按钮与链接|交替内容背景|关系线与分隔线' &&
	[...host.querySelectorAll('.ldp-setting-group-title')]
		.map((node) => node.textContent).join('|') ===
		'交替楼层背景|回复连接线|引用线|界面分隔线' &&
	host.querySelector(
		'[data-appearance-group="structure"] .ldp-color-group-head-actions .ldp-setting-switch',
	) !== null &&
	[...host.querySelectorAll<HTMLElement>('.ldp-color-group .ldp-setting-row')]
		.every((row) => Boolean(row.dataset.settingHelp) && !row.querySelector('small')) &&
		root.style.getPropertyValue('--ldp-reply-line-color') === '#6dab85' &&
		!root.classList.contains('ldp-structure-colors-disabled') &&
		settings.snapshot.draftCount === 0,
	'外观 form 必须只保留仍有运行态消费者的三组/四子组/帮助浮层/结构开关，并由唯一 CSS owner 初始化 13 个字段',
);
const replyWidth = host.querySelector<HTMLInputElement>(
	'[data-appearance-setting="replyLineWidth"]',
)!;
replyWidth.value = '2.5';
replyWidth.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
const structure = host.querySelector<HTMLInputElement>(
	'[data-appearance-setting="structureColorsEnabled"]',
)!;
structure.checked = false;
structure.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
assert(
	root.style.getPropertyValue('--ldp-reply-line-width') === '2.5px' &&
		root.style.getPropertyValue('--ldp-reply-line-emphasis-width') ===
			'5px' &&
		root.style.getPropertyValue('--ldp-reply-line-color') ===
			'transparent' &&
		root.classList.contains('ldp-structure-colors-disabled') &&
		Number(settings.snapshot.draftCount) === 2 &&
		appearance.snapshot.previewing,
	'编辑结构线必须只经共享 appearance preview 同步粗细、强调倍数和关闭状态',
);

environment = Object.freeze({ ...environment, theme: 'dark' });
environmentChanges.emit(environment);
assert(
	root.style.getPropertyValue('--tertiary') === '#78c295' &&
		root.style.getPropertyValue('--ldp-zebra-color') === '#1b2b21' &&
		Number(settings.snapshot.draftCount) === 2,
	'主题变化必须重新解析默认暗色，同时保留未保存的外观草稿',
);
const accent = host.querySelector<HTMLInputElement>(
	'[data-appearance-setting="accentColor"]',
)!;
accent.value = '#ff0000';
accent.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
const resolvedAccent = root.style.getPropertyValue('--tertiary');
assert(
	resolvedAccent !== '#ff0000' &&
		resolvedAccent === appearance.snapshot.colors.accentColor &&
		appearance.snapshot.embedded.profile.accentColor === resolvedAccent &&
		appearance.snapshot.embedded.profile.accentColorDark === resolvedAccent,
	'自定义颜色必须按当前主题限幅，并将同一 resolved profile 投给 embedded host',
);

const saved = settings.saveAll();
assert(
	saved.kind === 'saved' &&
		saved.count === 3 &&
		updateCount === 1 &&
		preferences.appearanceProfile.accentColor === '#ff0000' &&
		preferences.appearanceProfile.replyLineWidth === 2.5 &&
		!preferences.appearanceProfile.structureColorsEnabled &&
		Number(settings.snapshot.draftCount) === 0 &&
		!appearance.snapshot.previewing,
	'外观草稿必须一次保存为完整 profile，再由持久偏好接管 CSS',
);

preferences = Object.freeze({
	...preferences,
	appearanceProfile: Object.freeze({
		...preferences.appearanceProfile,
		dividerLineWidth: 3,
	}),
});
preferenceChanges.emit(preferences);
assert(
	host.querySelector<HTMLInputElement>(
		'[data-appearance-setting="dividerLineWidth"]',
	)?.value === '3' &&
		root.style.getPropertyValue('--ldp-divider-line-width') === '3px',
	'外部外观更新必须同时 rebase form 和唯一 runtime CSS',
);

const appearanceChangesBeforeUnrelated = appearanceChanges;
preferences = Object.freeze({
	...preferences,
	performancePageSize: preferences.performancePageSize + 1,
});
preferenceChanges.emit(preferences);
assert(
	appearanceChanges === appearanceChangesBeforeUnrelated &&
		root.style.getPropertyValue('--ldp-divider-line-width') === '3px',
	'无关偏好 revision 不得重写外观 CSS、发 Signal 或刷新十三项表单',
);

form.destroy();
appearance.destroy();
settings.destroy();
assert(
	host.childElementCount === 0 &&
		preferenceChanges.size === 0 &&
		environmentChanges.size === 0 &&
		root.style.getPropertyValue('--tertiary').startsWith('#010203') &&
		root.classList.contains('ldp-structure-colors-disabled') &&
		!root.style.getPropertyValue('--ldp-reply-line-width'),
	'销毁必须释放 form/主题订阅并恢复接管前的 inline CSS 与结构 class',
);
