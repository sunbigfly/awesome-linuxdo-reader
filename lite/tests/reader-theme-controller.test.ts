import { parseHTML } from 'linkedom';
import {
	ReaderThemeController,
	readerPreferencesThemeAdapter,
} from '../src/appearance/reader-theme-controller.js';
import { Signal } from '../src/kernel/signal.js';
import { ReaderFeedbackSurface } from '../src/shell/reader-feedback-surface.js';
import { ReaderThemeSettingsControl } from '../src/settings/reader-theme-settings-control.js';
import type { ReaderPreferences } from '../src/state/reader-preferences-schema.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body><main id="root"></main><div id="theme"></div></body></html>',
);
const document = parsedDocument as unknown as Document;
const root = document.querySelector<HTMLElement>('#root')!;
const host = document.querySelector<HTMLElement>('#theme')!;
const preferenceChanges = new Signal<Readonly<ReaderPreferences>>();
const systemChanges = new Signal<boolean>();
let preferences = Object.freeze({
	themeMode: 'system',
} as ReaderPreferences);
let systemDark = false;
const hostTransitions: string[] = [];
let hostListener: ((mode: 'light' | 'dark' | 'system') => void) | null = null;
let hostSubscriptionReleased = false;
const emitHostTheme = (mode: 'light' | 'dark' | 'system') => {
	const listener = hostListener;
	if (listener) listener(mode);
};
const theme = new ReaderThemeController({
	root,
	preferences: readerPreferencesThemeAdapter,
	readPreferences: () => preferences,
	preferenceChanges,
	system: {
		readDark: () => systemDark,
		subscribe: (listener, scope) =>
			systemChanges.subscribe(listener, scope),
	},
});
assert(
	theme.snapshot.mode === 'system' &&
		theme.snapshot.resolved === 'light' &&
		root.dataset.ldpThemeMode === 'system' &&
		root.dataset.ldpTheme === 'light' &&
		root.style.colorScheme === 'light',
	'主题 controller 必须把 system 偏好与系统媒体状态解析到唯一 Reader root',
);

const feedback = new ReaderFeedbackSurface({
	document,
	root: document.body,
	focusSoon: (callback) => callback(),
});
const control = new ReaderThemeSettingsControl({
	document,
	host,
	theme,
	feedback,
	hostTheme: {
		apply(mode) {
			hostTransitions.push(mode);
			return true;
		},
		subscribe(listener, scope) {
			hostListener = listener;
			const cleanup = () => {
				hostSubscriptionReleased = true;
				hostListener = null;
			};
			scope.add(cleanup);
			return cleanup;
		},
	},
	persist(patch) {
		preferences = Object.freeze({ ...preferences, ...patch });
		preferenceChanges.emit(preferences);
		return preferences;
	},
});
assert(
	host.querySelectorAll('.ldp-settings-theme-button').length === 3 &&
		['sun', 'moon', 'monitor'].every((icon) =>
			host.querySelector(`svg[data-ldp-reader-icon][data-icon="${icon}"]`) !== null) &&
		host.querySelector<HTMLButtonElement>(
			'[data-reader-theme-mode="system"]',
		)?.getAttribute('aria-pressed') === 'true',
	'主题设置必须提供明亮、暗色、跟随系统三个即时按钮并标记当前值',
);
host.querySelector<HTMLButtonElement>(
	'[data-reader-theme-mode="dark"]',
)!.click();
assert(
	String(preferences.themeMode) === 'dark' &&
		hostTransitions.join(',') === 'dark' &&
		String(theme.snapshot.resolved) === 'dark' &&
			String(root.dataset.ldpTheme) === 'dark' &&
		host.querySelector<HTMLButtonElement>(
			'[data-reader-theme-mode="dark"]',
		)?.classList.contains('active'),
	'主题按钮必须经唯一偏好写端口更新 controller/活动态，并同步宿主原生主题',
);
host.querySelector<HTMLButtonElement>(
	'[data-reader-theme-mode="system"]',
)!.click();
systemDark = true;
systemChanges.emit(true);
assert(
		String(theme.snapshot.mode) === 'system' &&
			String(theme.snapshot.resolved) === 'dark' &&
			String(root.dataset.ldpThemeMode) === 'system' &&
			String(root.dataset.ldpTheme) === 'dark',
	'跟随系统时媒体变化必须只更新 resolved theme，不覆盖持久 mode',
);
assert(
	hostTransitions.join(',') === 'dark,system',
	'跟随系统按钮必须调用宿主原生自动主题动作',
);
emitHostTheme('light');
assert(
	String(preferences.themeMode) === 'light' &&
		String(theme.snapshot.mode) === 'light' &&
		String(root.dataset.ldpTheme) === 'light' &&
		hostTransitions.join(',') === 'dark,system',
	'宿主外部主题事件必须回写规范偏好且不得反向重复调用宿主动作',
);

control.destroy();
feedback.destroy();
theme.destroy();
assert(
	!host.children.length &&
		hostSubscriptionReleased &&
		root.dataset.ldpTheme === undefined &&
		root.dataset.ldpThemeMode === undefined &&
		!root.style.colorScheme,
	'销毁必须撤销主题按钮与 Reader root 自有投影',
);
