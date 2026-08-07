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
		surfaceHost.querySelectorAll('.ldp-settings-tab').length === 15 &&
		surfaceHost.querySelector('.ldp-settings-nav > [data-settings-panel="user"]') ===
			surfaceHost.querySelector('.ldp-settings-nav')?.firstElementChild &&
		surfaceHost.querySelectorAll('.ldp-settings-section').length === 15,
	'设置 View 必须只有一个 Shell 入口、一个弹层、独立用户入口、3 个分组和 15 个面板',
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
			'.ldp-settings-save-all svg[data-icon="check"]',
		) !== null,
	'设置入口、目录、搜索、保存和关闭必须全部由共享图标入口渲染',
);
assert(
	view.snapshot.activePanelId === 'user' &&
		surfaceHost.querySelector<HTMLElement>('.ldp-settings-search-shell')!.hidden &&
		!surfaceHost.querySelector('.ldp-settings-panel')
			?.classList.contains('is-settings-pages'),
	'设置默认页必须对齐主线用户信息模式，并隐藏仅属于设置页的搜索条',
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

view.open('performance');
assert(
	view.snapshot.open &&
		String(view.snapshot.activePanelId) === 'performance' &&
		actions.querySelector('.ldp-settings-toggle')
			?.getAttribute('aria-expanded') === 'true' &&
		viewChanges.at(-1) === true,
	'打开设置必须同步入口 ARIA、controller 激活面板和唯一 View 状态信号',
);
const escapeSettings = new parsedWindow.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(escapeSettings, 'key', { value: 'Escape' });
surfaceHost.querySelector('.ldp-settings-popover')?.dispatchEvent(escapeSettings);
await Promise.resolve();
assert(
	!view.snapshot.open,
	'设置必须从 document capture 阶段接收 Esc 并关闭当前前置 surface',
);
view.open('performance');
const search = surfaceHost.querySelector<HTMLInputElement>(
	'.ldp-settings-search-input',
)!;
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
		view.snapshot.query === '按两次 esc' &&
		surfaceHost.querySelector('.ldp-settings-search-status')?.textContent ===
			'找到 1 个设置分区',
	'搜索索引必须包含领域 form 实际渲染文字，不能只依赖静态面板关键词',
);
surfaceHost.querySelector<HTMLButtonElement>(
	'.ldp-settings-search-clear',
)!.click();

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
