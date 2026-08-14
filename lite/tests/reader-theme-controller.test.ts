import { parseHTML } from 'linkedom';
import {
	ReaderThemeController,
	readerPreferencesThemeAdapter,
} from '../src/appearance/reader-theme-controller.js';
import {
	readerLocalSunTimes,
} from '../src/appearance/reader-local-sun-clock.js';
import { Signal } from '../src/kernel/signal.js';
import { ReaderFeedbackSurface } from '../src/shell/reader-feedback-surface.js';
import { ReaderThemeSettingsControl } from '../src/settings/reader-theme-settings-control.js';
import type { ReaderPreferences } from '../src/state/reader-preferences-schema.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body><main id="root"></main><div id="theme"></div></body></html>',
);
const document = parsedDocument as unknown as Document;
const root = document.querySelector<HTMLElement>('#root')!;
const host = document.querySelector<HTMLElement>('#theme')!;
const preferenceChanges = new Signal<Readonly<ReaderPreferences>>();
const systemChanges = new Signal<boolean>();
let preferences = Object.freeze({
	themeMode: 'system',
	autoDarkModeEnabled: false,
	autoDarkModeStartTime: 'sunset',
} as ReaderPreferences);
let systemDark = false;
let now = new Date(2026, 7, 11, 17, 30, 0);
let scheduled: (() => void) | null = null;
let scheduleReleased = false;
let sunRequests = 0;
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
	clock: {
		now: () => now,
		schedule(listener) {
			scheduled = listener;
			scheduleReleased = false;
			return () => {
				if (scheduled === listener) scheduled = null;
				scheduleReleased = true;
			};
		},
		async resolveSunTimes() {
			sunRequests += 1;
			return Object.freeze({
				sunriseMinutes: 6 * 60 + 10,
				sunsetMinutes: 18 * 60 + 20,
				source: 'location' as const,
			});
		},
	},
	system: {
		readDark: () => systemDark,
		subscribe: (listener, scope) =>
			systemChanges.subscribe(listener, scope),
	},
});
assert(
	theme.snapshot.mode === 'system' &&
		theme.snapshot.resolved === 'light' &&
		!theme.snapshot.automatic.enabled &&
		root.dataset.ldpThemeMode === 'system' &&
		root.dataset.ldpTheme === 'light' &&
		root.dataset.ldpThemeAutomatic === 'off' &&
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
			hostListener?.(mode);
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
		host.querySelector('.ldp-settings-theme-automatic input') !== null &&
		host.querySelectorAll('.ldp-settings-theme-time select').length === 2 &&
		host.querySelector('.ldp-settings-theme-automatic')?.firstElementChild
			?.classList.contains('ldp-settings-theme-modes') === true &&
		host.querySelector<HTMLElement>(
			'.ldp-settings-theme-automatic-toggle',
		)?.dataset.ldpTooltipLabel === '自动暗色：已关闭' &&
		['clock', 'clock-check'].every((icon) =>
			host.querySelector(
				`.ldp-settings-theme-automatic-toggle svg[data-icon="${icon}"]`,
			) !== null) &&
		host.querySelector('.ldp-settings-theme-automatic-head')?.lastElementChild
			?.classList.contains(
				'ldp-settings-theme-automatic-disclosure',
			) === true &&
		host.querySelector('.ldp-settings-theme-automatic-label') === null &&
		host.querySelector<HTMLElement>(
			'.ldp-settings-theme-automatic-details',
		)?.hidden === true &&
		host.querySelector<HTMLButtonElement>(
			'.ldp-settings-theme-automatic-disclosure',
		)?.getAttribute('aria-expanded') === 'false' &&
		host.querySelector<HTMLButtonElement>(
			'.ldp-settings-theme-sunset',
		)?.getAttribute('aria-pressed') === 'true' &&
		['sun', 'moon', 'monitor'].every((icon) =>
			host.querySelector(`svg[data-ldp-reader-icon][data-icon="${icon}"]`) !== null) &&
		host.querySelector<HTMLButtonElement>(
			'[data-reader-theme-mode="system"]',
		)?.getAttribute('aria-pressed') === 'true',
	'主题设置必须提供三个即时按钮，自动暗色时间设置默认折叠',
);
const automaticDisclosure = host.querySelector<HTMLButtonElement>(
	'.ldp-settings-theme-automatic-disclosure',
)!;
const automaticDetails = host.querySelector<HTMLElement>(
	'.ldp-settings-theme-automatic-details',
)!;
automaticDisclosure.click();
assert(
	!automaticDetails.hidden &&
		automaticDisclosure.getAttribute('aria-expanded') === 'true',
	'自动暗色标题必须能展开时间设置',
);
document.body.dispatchEvent(new parsedWindow.Event('pointerdown', {
	bubbles: true,
}));
assert(
	automaticDetails.hidden &&
		automaticDisclosure.getAttribute('aria-expanded') === 'false',
	'点击自动暗色控件以外的区域必须收起时间设置',
);
const automatic = host.querySelector<HTMLInputElement>(
	'.ldp-settings-theme-automatic input',
)!;
automatic.checked = true;
automatic.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
await Promise.resolve();
await Promise.resolve();
assert(
	preferences.autoDarkModeEnabled &&
		sunRequests === 1 &&
		theme.snapshot.automatic.resolvedStartTime === '18:20' &&
		theme.snapshot.automatic.sunriseTime === '06:10' &&
		theme.snapshot.resolved === 'light' &&
		String(root.dataset.ldpThemeAutomatic) === 'scheduled' &&
		!automaticDetails.hidden,
	'启用自动暗色后必须按需解析当地日落，并在日落前保留原主题',
);
document.body.dispatchEvent(new parsedWindow.Event('pointerdown', {
	bubbles: true,
}));
assert(
	automaticDetails.hidden,
	'首次开启自动暗色后允许点击外部区域收起时间设置',
);
assert(
	host.querySelector<HTMLSelectElement>(
			'.ldp-settings-theme-hour',
		)?.value === '18' &&
		host.querySelector<HTMLSelectElement>(
			'.ldp-settings-theme-minute',
		)?.value === '20',
	'当地日落解析后必须同步项目时间下拉的小时与分钟',
);
now = new Date(2026, 7, 11, 18, 21, 0);
const sunsetBoundary = scheduled as unknown as (() => void) | null;
if (sunsetBoundary) sunsetBoundary();
assert(
	theme.snapshot.automatic.active &&
		String(theme.snapshot.resolved) === 'dark' &&
		String(root.dataset.ldpThemeAutomatic) === 'active' &&
		String(preferences.themeMode) === 'system' &&
		hostTransitions[hostTransitions.length - 1] === 'dark' &&
		host.querySelector<HTMLButtonElement>(
			'[data-reader-theme-mode="dark"]',
		)?.classList.contains('active') === true,
	'到达当地日落后必须复用暗色按钮链路同步宿主，同时保留原主题模式',
);
const startTime = host.querySelector<HTMLElement>(
	'.ldp-settings-theme-time',
)!;
assert(
	startTime.dataset.ldpTooltipLabel?.includes('当地日落') === true &&
		!startTime.hasAttribute('title'),
	'时间提示必须交给项目统一 tooltip，并由其默认优先定位在控件上方',
);
const startHour = host.querySelector<HTMLSelectElement>(
	'.ldp-settings-theme-hour',
)!;
const startMinute = host.querySelector<HTMLSelectElement>(
	'.ldp-settings-theme-minute',
)!;
[...startHour.options].find((option) => option.value === '20')!.selected = true;
[...startMinute.options].find((option) => option.value === '30')!.selected = true;
startMinute.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
assert(
	preferences.autoDarkModeStartTime === '20:30' &&
		!theme.snapshot.automatic.active &&
		theme.snapshot.resolved === 'light' &&
		hostTransitions[hostTransitions.length - 1] === 'system',
	'用户设置固定开启时间后必须立即重排边界并恢复日落覆盖前的原主题',
);
host.querySelector<HTMLButtonElement>(
	'.ldp-settings-theme-sunset',
)!.click();
assert(
	String(preferences.autoDarkModeStartTime) === 'sunset' &&
		theme.snapshot.automatic.active &&
		String(theme.snapshot.resolved) === 'dark' &&
		hostTransitions[hostTransitions.length - 1] === 'dark',
	'日落按钮必须恢复动态当地日落，而不是写死当天时间',
);
automatic.checked = false;
automatic.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
assert(
	!preferences.autoDarkModeEnabled &&
		theme.snapshot.resolved === 'light' &&
		root.dataset.ldpThemeAutomatic === 'off' &&
		automaticDetails.hidden &&
		scheduleReleased &&
		hostTransitions[hostTransitions.length - 1] === 'system' &&
		host.querySelector<HTMLButtonElement>(
			'[data-reader-theme-mode="system"]',
		)?.classList.contains('active') === true,
	'关闭自动暗色必须取消边界计时并立即恢复原主题',
);
automatic.checked = true;
automatic.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
assert(
	automaticDetails.hidden,
	'自动暗色只在第一次开启时自动展开，后续开启必须保持折叠',
);
automatic.checked = false;
automatic.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
host.querySelector<HTMLButtonElement>(
	'[data-reader-theme-mode="dark"]',
)!.click();
assert(
	String(preferences.themeMode) === 'dark' &&
		hostTransitions[hostTransitions.length - 1] === 'dark' &&
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
	hostTransitions[hostTransitions.length - 1] === 'system',
	'跟随系统按钮必须调用宿主原生自动主题动作',
);
const hostTransitionCountBeforeExternal = hostTransitions.length;
emitHostTheme('light');
assert(
	String(preferences.themeMode) === 'light' &&
		String(theme.snapshot.mode) === 'light' &&
		String(root.dataset.ldpTheme) === 'light' &&
		hostTransitions.length === hostTransitionCountBeforeExternal,
	'宿主外部主题事件必须回写规范偏好且不得反向重复调用宿主动作',
);

control.destroy();
feedback.destroy();
theme.destroy();
const shanghaiSummer = readerLocalSunTimes(
	new Date(2026, 5, 21),
	31.2304,
	121.4737,
	-8 * 60,
);
assert(
	shanghaiSummer.source === 'location' &&
		shanghaiSummer.sunriseMinutes >= 280 &&
		shanghaiSummer.sunriseMinutes <= 305 &&
		shanghaiSummer.sunsetMinutes >= 1_130 &&
		shanghaiSummer.sunsetMinutes <= 1_155 &&
		readerLocalSunTimes(new Date(), 999, 0).source === 'fallback',
	'当地日出日落必须在本机按坐标与时区计算，非法或极区结果安全回落',
);
assert(
	!host.children.length &&
	hostSubscriptionReleased &&
	root.dataset.ldpTheme === undefined &&
	root.dataset.ldpThemeMode === undefined &&
	root.dataset.ldpThemeAutomatic === undefined &&
	!root.style.colorScheme,
	'销毁必须撤销主题按钮与 Reader root 自有投影',
);
