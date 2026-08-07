import { parseHTML } from 'linkedom';
import {
	ReaderLayoutStyleController,
	readerPreferencesLayoutAdapter,
	type ReaderLayoutMode,
} from '../src/layout/reader-layout-style-controller.js';
import { Signal } from '../src/kernel/signal.js';
import {
	ReaderLayoutSettingsForm,
} from '../src/settings/reader-layout-settings-form.js';
import {
	ReaderSettingsController,
} from '../src/settings/reader-settings-controller.js';
import {
	createReaderPreferencesDefaults,
	type ReaderPreferences,
} from '../src/state/reader-preferences-schema.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body><main id="root" style="--ldp-layout-left:9%!important"></main><section id="host"></section></body></html>',
);
const document = parsedDocument as unknown as Document;
const root = document.querySelector<HTMLElement>('#root')!;
const host = document.querySelector<HTMLElement>('#host')!;
const preferenceChanges = new Signal<Readonly<ReaderPreferences>>();
const modeChanges = new Signal<ReaderLayoutMode>();
let mode: ReaderLayoutMode = 'standard';
let preferences = createReaderPreferencesDefaults({
	viewportWidth: 1440,
	viewportHeight: 900,
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
	initialPanelId: 'layout',
});
const layout = new ReaderLayoutStyleController({
	root,
	preferences: readerPreferencesLayoutAdapter,
	readPreferences: () => preferences,
	preferenceChanges,
	mode: {
		read: () => mode,
		subscribe: (listener, scope) =>
			modeChanges.subscribe(listener, scope),
	},
});
const form = new ReaderLayoutSettingsForm({
	document,
	host,
	controller: settings,
	layout,
});
let settingsChanges = 0;
settings.changes.subscribe(() => {
	settingsChanges += 1;
});

assert(
	host.querySelectorAll('[data-layout-region]').length === 5 &&
		root.style.getPropertyValue('--ldp-layout-left') === '0%' &&
		root.style.getPropertyValue('--ldp-layout-main') === '88%' &&
		settings.snapshot.draftCount === 0,
	'布局 runtime/form 必须从普通 profile 投影 5 个字段和唯一 CSS 变量 owner',
);
const left = host.querySelector<HTMLInputElement>(
	'[data-layout-region="left"]',
)!;
left.value = '10';
left.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
assert(
	root.style.getPropertyValue('--ldp-layout-left') === '10%' &&
		root.style.getPropertyValue('--ldp-layout-main') === '78%' &&
		host.querySelector('[data-layout-value="main"]')?.textContent ===
			'78%' &&
		Number(settings.snapshot.draftCount) === 2 &&
		layout.snapshot.previewing &&
		settingsChanges === 1,
	'编辑一区必须按旧优先序自动再平衡到 100%，只经 layout runtime 预览并发布一次草稿状态',
);

mode = 'fullpage';
modeChanges.emit(mode);
assert(
	left.value === '15' &&
		root.style.getPropertyValue('--ldp-layout-left') === '15%' &&
		root.style.getPropertyValue('--ldp-layout-main') === '70%' &&
		Number(settings.snapshot.draftCount) === 2,
	'切换全屏必须显示独立 profile，保留普通形态草稿但不把它投到当前 CSS',
);
const gap = host.querySelector<HTMLInputElement>(
	'[data-layout-region="gap"]',
)!;
gap.value = '6';
gap.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
assert(
	root.style.getPropertyValue('--ldp-layout-gap') === '6%' &&
		root.style.getPropertyValue('--ldp-layout-main') === '69%' &&
		Number(settings.snapshot.draftCount) === 4,
	'两种形态必须各自保留草稿，并由同一个 layout adapter 聚合',
);

const saved = settings.saveAll();
assert(
	saved.kind === 'saved' &&
		saved.count === 4 &&
		updateCount === 1 &&
		preferences.layoutProfile.left === 10 &&
		preferences.layoutProfile.main === 78 &&
		preferences.fullpageLayoutProfile.gap === 6 &&
		preferences.fullpageLayoutProfile.main === 69 &&
		Number(settings.snapshot.draftCount) === 0 &&
		!layout.snapshot.previewing,
	'普通/全屏草稿必须在一次 preference revision 内保存，并由持久 profile 接管 CSS',
);

mode = 'standard';
modeChanges.emit(mode);
assert(
	root.style.getPropertyValue('--ldp-layout-left') === '10%' &&
		root.style.getPropertyValue('--ldp-layout-main') === '78%',
	'保存后切回普通形态必须读取同一已持久 profile',
);
left.value = '12';
left.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
preferences = Object.freeze({
	...preferences,
	layoutProfile: Object.freeze({
		...preferences.layoutProfile,
		timeline: 6,
		right: 6,
	}),
});
preferenceChanges.emit(preferences);
assert(
	host.querySelector<HTMLInputElement>(
		'[data-layout-region="timeline"]',
	)?.value === '6' &&
		host.querySelector<HTMLInputElement>(
			'[data-layout-region="right"]',
		)?.value === '6' &&
		root.style.getPropertyValue('--ldp-layout-timeline') === '6%' &&
		root.style.getPropertyValue('--ldp-layout-right') === '6%' &&
		Number(settings.snapshot.draftCount) === 2,
	'外部布局更新必须把未编辑字段同时 rebase 到草稿控件和当前 preview CSS',
);
preferences = Object.freeze({
	...preferences,
	layoutProfile: Object.freeze({
		left: 12,
		main: 76,
		gap: 0,
		timeline: 6,
		right: 6,
	}),
});
preferenceChanges.emit(preferences);
assert(
	Number(settings.snapshot.draftCount) === 0 &&
		!layout.snapshot.previewing &&
		root.style.getPropertyValue('--ldp-layout-timeline') === '6%' &&
		root.style.getPropertyValue('--ldp-layout-right') === '6%',
	'外部快照吸收全部本地布局草稿后必须清除 stale preview',
);
left.value = '14';
left.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
settings.discardAll();
assert(
	left.value === '12' &&
		Number(settings.snapshot.draftCount) === 0 &&
		!layout.snapshot.previewing &&
		root.style.getPropertyValue('--ldp-layout-left') === '12%',
	'放弃必须清除 preview 并恢复当前持久布局，不留下 CSS 草稿',
);

form.destroy();
layout.destroy();
settings.destroy();
assert(
	host.childElementCount === 0 &&
		preferenceChanges.size === 0 &&
		modeChanges.size === 0 &&
		root.style.getPropertyValue('--ldp-layout-left').startsWith('9%') &&
		!root.style.getPropertyValue('--ldp-layout-main'),
	'销毁必须释放 form/订阅并恢复接管前的 inline CSS',
);
