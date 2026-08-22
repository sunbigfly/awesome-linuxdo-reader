import { parseHTML } from 'linkedom';
import { ReaderFeedbackSurface } from '../src/shell/reader-feedback-surface.js';
import {
	ReaderSettingsController,
} from '../src/settings/reader-settings-controller.js';
import { ReaderSettingsView } from '../src/settings/reader-settings-view.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestPreferences {
	readonly pageSize: number;
}

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body><header id="actions"></header><main id="surface"></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const actions = document.querySelector<HTMLElement>('#actions')!;
const surfaceHost = document.querySelector<HTMLElement>('#surface')!;
let preferences: Readonly<TestPreferences> = Object.freeze({ pageSize: 20 });
let updateCount = 0;
let changeCount = 0;
let failAccept = false;
let failDiscard = false;
const errors: unknown[] = [];
const controller = new ReaderSettingsController<TestPreferences>({
	preferences: {
		read: () => preferences,
		update(patch) {
			updateCount += 1;
			preferences = Object.freeze({ ...preferences, ...patch });
			return preferences;
		},
	},
});
const feedback = new ReaderFeedbackSurface({
	document,
	root: surfaceHost,
	focusSoon: (callback) => callback(),
});
const view = new ReaderSettingsView({
	document,
	controller,
	feedback,
	toggleHost: actions,
	surfaceHost,
	onError: (cause) => errors.push(cause),
});
const viewChanges: boolean[] = [];
view.changes.subscribe((snapshot) => viewChanges.push(snapshot.open));

assert(
	actions.querySelectorAll('.ldp-settings-toggle').length === 1 &&
		surfaceHost.querySelectorAll('.ldp-settings-popover').length === 1 &&
		surfaceHost.querySelectorAll('.ldp-settings-nav-group').length === 3 &&
		surfaceHost.querySelectorAll('.ldp-settings-tab').length === 18 &&
		surfaceHost.querySelector('.ldp-settings-nav > [data-settings-panel="user"]') ===
			surfaceHost.querySelector('.ldp-settings-nav')?.firstElementChild &&
		surfaceHost.querySelectorAll('.ldp-settings-section').length === 18,
	'设置 View 必须只有一个 Shell 入口、一个弹层、独立用户入口、3 个分组和 18 个面板',
);
assert(
	actions.querySelector(
		'.ldp-settings-toggle svg[data-icon="header-settings"]',
	) !== null &&
		[...surfaceHost.querySelectorAll('.ldp-settings-tab')].every(
			(tab) => tab.querySelector('svg[data-ldp-reader-icon]') !== null,
		) &&
		surfaceHost.querySelector(
			'.ldp-settings-close svg[data-icon="x"]',
		) !== null &&
		surfaceHost.querySelector(
			'.ldp-settings-search svg[data-icon="search"]',
		) !== null &&
		surfaceHost.querySelector(
			'.ldp-settings-search-clear svg[data-icon="x"]',
		) !== null &&
		surfaceHost.querySelector(
			'.ldp-settings-menu-toggle svg[data-icon="list"]',
		) !== null &&
		surfaceHost.querySelector(
			'.ldp-settings-save-all svg[data-icon="check"]',
		) !== null,
	'设置入口、目录、搜索、保存和关闭必须全部由共享图标入口渲染',
);
const mobileMenuToggle = surfaceHost.querySelector<HTMLButtonElement>(
	'.ldp-settings-menu-toggle',
)!;
const mobileMenuCurrent = surfaceHost.querySelector<HTMLElement>(
	'.ldp-settings-menu-current',
)!;
assert(
	mobileMenuToggle.getAttribute('aria-expanded') === 'false' &&
		mobileMenuToggle.getAttribute('aria-controls') ===
			'ldp-settings-mobile-nav' &&
		mobileMenuCurrent.textContent === '用户信息',
	'移动端分类入口必须声明受控列表，并同步显示当前设置分类',
);
assert(
	view.snapshot.activePanelId === 'user' &&
		!surfaceHost.querySelector<HTMLElement>('.ldp-settings-search-shell')!.hidden &&
		surfaceHost.querySelector('.ldp-settings-search-shell')?.parentElement
			?.classList.contains('ldp-settings-brand') &&
		surfaceHost.querySelector('.ldp-settings-search-shell')?.parentElement
			?.parentElement?.classList.contains('ldp-settings-tabs') &&
		surfaceHost.querySelector('.ldp-settings-search-shell')?.previousElementSibling
			?.classList.contains('ldp-settings-brand-name') &&
		!surfaceHost.querySelector('.ldp-settings-panel')
			?.contains(surfaceHost.querySelector('.ldp-settings-search-shell')) &&
		!surfaceHost.querySelector('.ldp-settings-panel')
			?.classList.contains('is-settings-pages'),
	'设置默认页必须对齐主线用户信息模式，并让收起搜索固定在品牌区内且不参与头部高度',
);
assert(
	view.panelHost('performance').dataset.settingsContent === 'performance',
	'领域表单必须只挂到 panelHost 返回的稳定锚点',
);
assert(
	view.themeHost().classList.contains('ldp-settings-theme') &&
		view.themeHost().parentElement?.classList.contains(
			'ldp-settings-footer',
		),
	'主题领域必须只挂到设置侧栏底部的稳定锚点',
);

const search = surfaceHost.querySelector<HTMLInputElement>(
	'.ldp-settings-search-input',
)!;
const performanceTab = surfaceHost.querySelector<HTMLButtonElement>(
	'[data-settings-panel="performance"].ldp-settings-tab',
)!;
const originalSearchFocus = search.focus;
const originalPerformanceTabFocus = performanceTab.focus;
let settingsOpenFocusTarget = '';
search.focus = () => {
	settingsOpenFocusTarget = 'search';
};
performanceTab.focus = () => {
	settingsOpenFocusTarget = 'panel';
};
view.open('performance');
search.focus = originalSearchFocus;
performanceTab.focus = originalPerformanceTabFocus;
assert(
	view.snapshot.open &&
		String(view.snapshot.activePanelId) === 'performance' &&
		actions.querySelector('.ldp-settings-toggle')
			?.getAttribute('aria-expanded') === 'true' &&
		viewChanges.at(-1) === true &&
		settingsOpenFocusTarget === 'panel',
	'打开设置必须同步入口 ARIA、controller 激活面板和唯一 View 状态信号，并让搜索默认保持收起',
);
assert(
	mobileMenuCurrent.textContent === '性能设置',
	'切换设置页后移动端分类入口必须投影当前标题',
);
const settingsPopover = surfaceHost.querySelector<HTMLElement>(
	'.ldp-settings-popover',
)!;
const performanceIntro = surfaceHost.querySelector<HTMLElement>(
	'[data-settings-panel="performance"] .ldp-settings-intro',
)!;
surfaceHost.getBoundingClientRect = () => ({
	x: 0,
	y: 0,
	left: 0,
	top: 0,
	right: 1200,
	bottom: 900,
	width: 1200,
	height: 900,
	toJSON: () => ({}),
});
settingsPopover.getBoundingClientRect = () => ({
	x: 100,
	y: 80,
	left: 100,
	top: 80,
	right: 900,
	bottom: 680,
	width: 800,
	height: 600,
	toJSON: () => ({}),
});
const settingsPointer = (
	type: string,
	clientX: number,
	clientY: number,
): Event => {
	const event = new parsedWindow.Event(type, {
		bubbles: true,
		cancelable: true,
	});
	Object.defineProperties(event, {
		button: { value: 0 },
		pointerId: { value: 7 },
		clientX: { value: clientX },
		clientY: { value: clientY },
	});
	return event;
};
performanceIntro.dispatchEvent(settingsPointer('pointerdown', 320, 110));
assert(
	settingsPopover.classList.contains('ldp-settings-window-dragging'),
	'普通设置页标题栏必须与用户信息标题栏共用浮窗拖动入口',
);
settingsPopover.dispatchEvent(settingsPointer('pointermove', 344, 126));
settingsPopover.dispatchEvent(settingsPointer('pointerup', 344, 126));
assert(
	!settingsPopover.classList.contains('ldp-settings-window-dragging') &&
		settingsPopover.style.left === '124px' &&
		settingsPopover.style.top === '96px' &&
		settingsPopover.style.transform === 'none',
	'普通设置页拖动结束后必须提交新位置并完整释放拖动态',
);
let escapedWheelCount = 0;
const countEscapedWheel = (): void => {
	escapedWheelCount += 1;
};
surfaceHost.addEventListener('wheel', countEscapedWheel);
const settingsBoundaryWheel = new parsedWindow.Event('wheel', {
	bubbles: true,
	cancelable: true,
}) as unknown as WheelEvent;
Object.defineProperties(settingsBoundaryWheel, {
	deltaX: { value: 0 },
	deltaY: { value: 120 },
	deltaMode: { value: 0 },
});
surfaceHost.querySelector<HTMLElement>('.ldp-settings-nav')!
	.dispatchEvent(settingsBoundaryWheel);
surfaceHost.removeEventListener('wheel', countEscapedWheel);
assert(
	settingsBoundaryWheel.defaultPrevented && escapedWheelCount === 0,
	'设置导航抵达内部滚动边界后必须阻止滚轮继续冒泡到宿主页面',
);
mobileMenuToggle.click();
assert(
	mobileMenuToggle.getAttribute('aria-expanded') === 'true' &&
		settingsPopover.classList.contains('ldp-settings-menu-open'),
	'移动端分类入口必须显式打开同一设置浮窗内的分类列表抽屉',
);
surfaceHost.querySelector<HTMLElement>('.ldp-settings-panel')!.dispatchEvent(
	new parsedWindow.Event('pointerdown', { bubbles: true, cancelable: true }),
);
assert(
	mobileMenuToggle.getAttribute('aria-expanded') === 'false' &&
		!settingsPopover.classList.contains('ldp-settings-menu-open'),
	'点击移动端分类侧抽屉之外的内容区必须只收起内层菜单',
);
mobileMenuToggle.click();
const escapeSettings = new parsedWindow.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(escapeSettings, 'key', { value: 'Escape' });
surfaceHost.querySelector('.ldp-settings-popover')?.dispatchEvent(escapeSettings);
await Promise.resolve();
assert(
	view.snapshot.open &&
		mobileMenuToggle.getAttribute('aria-expanded') === 'false' &&
		!settingsPopover.classList.contains('ldp-settings-menu-open'),
	'分类列表展开时 Esc 必须先收起内层抽屉，不得直接关闭整个设置浮窗',
);
const closeSettings = new parsedWindow.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(closeSettings, 'key', { value: 'Escape' });
surfaceHost.querySelector('.ldp-settings-popover')?.dispatchEvent(closeSettings);
await Promise.resolve();
assert(
	!view.snapshot.open,
	'设置必须从 document capture 阶段接收 Esc 并关闭当前前置 surface',
);
view.open();
assert(
	view.snapshot.open &&
		view.snapshot.activePanelId === 'user' &&
		view.snapshot.query === '',
	'每次无指定入口重新打开设置都必须聚焦用户信息，并清除设置页搜索状态',
);
view.close();
view.open('performance');
search.value = 'indexeddb';
search.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
assert(
	String(view.snapshot.activePanelId) === 'cache' &&
		surfaceHost.querySelectorAll('.ldp-settings-tab:not([hidden])').length === 2 &&
		surfaceHost.querySelector('.ldp-settings-search-status')?.textContent ===
			'找到 1 个设置分区',
	'搜索必须保留独立用户入口、过滤三个目录分组，并把 active panel 收敛到首个结果',
);
view.panelHost('reading').textContent = '按两次 Esc 关闭阅读器';
search.value = '按两次 esc';
search.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
assert(
	String(view.snapshot.activePanelId) === 'reading' &&
		String(view.snapshot.query) === '按两次 esc' &&
		surfaceHost.querySelector('.ldp-settings-search-status')?.textContent ===
			'找到 1 个设置分区',
	'搜索索引必须包含领域 form 实际渲染文字，不能只依赖静态面板关键词',
);
surfaceHost.querySelector<HTMLButtonElement>(
	'.ldp-settings-search-clear',
)!.click();

const performanceRange = document.createElement('input');
performanceRange.type = 'range';
performanceRange.min = '0';
performanceRange.max = '100';
performanceRange.value = '25';
const performanceHelp = document.createElement('div');
performanceHelp.className = 'ldp-setting-row';
const performanceHelpCopy = document.createElement('small');
performanceHelpCopy.textContent = '性能帮助';
performanceHelp.append(performanceHelpCopy);
view.panelHost('performance').append(performanceRange, performanceHelp);
const fontRange = document.createElement('input');
fontRange.type = 'range';
fontRange.min = '0';
fontRange.max = '100';
fontRange.value = '75';
const fontHelp = document.createElement('div');
fontHelp.className = 'ldp-setting-row';
const fontHelpCopy = document.createElement('small');
fontHelpCopy.textContent = '字体帮助';
fontHelp.append(fontHelpCopy);
view.panelHost('font').append(fontRange, fontHelp);
surfaceHost.querySelector<HTMLButtonElement>(
	'#ldp-settings-tab-performance',
)!.click();
assert(
	performanceRange.style.getPropertyValue('--ldp-range-progress') === '25%' &&
		performanceHelp.dataset.settingHelp === '性能帮助' &&
		fontRange.style.getPropertyValue('--ldp-range-progress') === '' &&
		fontHelp.dataset.settingHelp === undefined,
	'面板切换只能同步当前可见表单，不能遍历隐藏设置页',
);
surfaceHost.querySelector<HTMLButtonElement>(
	'#ldp-settings-tab-font',
)!.click();
assert(
	fontRange.style.getPropertyValue('--ldp-range-progress') === '75%' &&
		fontHelp.dataset.settingHelp === '字体帮助',
	'隐藏表单首次进入时必须补齐动态字段和帮助语义',
);

controller.registerDraft({
	panelId: 'performance',
	changeCount: () => changeCount,
	validate: () => [],
	createPatch: () => ({ pageSize: 32 }),
	acceptPersisted: () => {
		if (failAccept) throw new Error('accept failed');
		changeCount = 0;
	},
	discard: () => {
		if (failDiscard) throw new Error('discard failed');
		changeCount = 0;
	},
});
changeCount = 2;
controller.refresh();
assert(
	view.snapshot.draftCount === 2 &&
		!surfaceHost.querySelector<HTMLElement>(
			'.ldp-settings-draft-bar',
		)!.hidden &&
		surfaceHost.querySelector(
			'[data-settings-panel="performance"] .ldp-settings-tab-draft-count',
		)?.textContent === '2',
	'草稿总数、面板徽标和保存栏必须只从 controller snapshot 派生',
);

const continueClose = view.requestClose();
surfaceHost.querySelector<HTMLButtonElement>(
	'.ldp-reader-action-cancel:not(.ldp-reader-action-secondary)',
)!.click();
assert(
	await continueClose === false && view.snapshot.open,
	'继续编辑必须保留设置弹层和全部草稿',
);

const discardClose = view.requestClose();
surfaceHost.querySelector<HTMLButtonElement>(
	'.ldp-reader-action-secondary',
)!.click();
assert(
	await discardClose === true &&
		!view.snapshot.open &&
		viewChanges.at(-1) === false &&
		changeCount === 0 &&
		updateCount === 0,
	'放弃并关闭必须从同一偏好快照回滚草稿且禁止写入',
);

changeCount = 1;
controller.refresh();
view.open('performance');
const saveClose = view.requestClose();
surfaceHost.querySelector<HTMLButtonElement>(
	'.ldp-reader-action-submit',
)!.click();
assert(
	await saveClose === true &&
		!view.snapshot.open &&
		Number(updateCount) === 1 &&
		preferences.pageSize === 32 &&
		changeCount === 0,
	'保存并关闭必须经 controller 聚合后只执行一次偏好写入',
);

changeCount = 1;
failAccept = true;
view.open('performance');
surfaceHost.querySelector<HTMLButtonElement>(
	'.ldp-settings-save-all',
)!.click();
assert(
	view.snapshot.open &&
		Number(view.snapshot.draftCount) === 1 &&
		surfaceHost.textContent?.includes('设置已保存，但表单同步失败') &&
		errors.some((cause) => String(cause).includes('accept failed')),
	'偏好已落盘但表单接纳失败时不得伪报完整成功或关闭仍有草稿的设置页',
);

failDiscard = true;
const failedDiscardClose = view.requestClose();
surfaceHost.querySelector<HTMLButtonElement>(
	'.ldp-reader-action-secondary',
)!.click();
assert(
	await failedDiscardClose === false &&
		view.snapshot.open &&
		surfaceHost.textContent?.includes('部分设置未能放弃') &&
		errors.some((cause) => String(cause).includes('discard failed')),
	'放弃失败时必须保留设置页与草稿，并通过唯一反馈面显式报告',
);

view.destroy();
feedback.destroy();
controller.destroy();
assert(
	!actions.querySelector('.ldp-settings-toggle') &&
		!surfaceHost.querySelector('.ldp-settings-popover') &&
		!surfaceHost.querySelector('.ldp-reader-confirm-layer'),
	'销毁必须释放设置入口、弹层与共享确认 DOM',
);
