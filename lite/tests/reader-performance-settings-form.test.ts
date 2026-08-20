import { parseHTML } from 'linkedom';
import { Signal } from '../src/kernel/signal.js';
import {
	ReaderPerformanceSettingsForm,
	readerPreferencesPerformanceSettingsAdapter,
} from '../src/settings/reader-performance-settings-form.js';
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
	'<!doctype html><html><body><main id="host"></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const host = document.querySelector<HTMLElement>('#host')!;
const preferenceChanges = new Signal<Readonly<ReaderPreferences>>();
let preferences = createReaderPreferencesDefaults({
	viewportWidth: 1440,
	viewportHeight: 900,
});
let updateCount = 0;
const controller = new ReaderSettingsController<ReaderPreferences>({
	preferences: {
		read: () => preferences,
		update(patch) {
			updateCount += 1;
			preferences = Object.freeze({ ...preferences, ...patch });
			preferenceChanges.emit(preferences);
			return preferences;
		},
	},
	initialPanelId: 'performance',
});
const form = new ReaderPerformanceSettingsForm({
	document,
	host,
	controller,
	preferences: readerPreferencesPerformanceSettingsAdapter,
	readPreferences: () => preferences,
	preferenceChanges,
});

assert(
	host.querySelectorAll('.ldp-performance-preset').length === 4 &&
		host.querySelectorAll('.ldp-settings-category-group').length === 5 &&
		host.querySelectorAll('[data-performance-key]').length === 7 &&
		!host.querySelector<HTMLInputElement>(
			'[data-performance-host-key="suspendHostTurnstileInBackground"]',
		)?.checked &&
		host.querySelector(
			'[data-settings-category="performance-host-runtime"]',
		)?.textContent?.includes('宿主后台资源（实验）') &&
		host.querySelector(
			'[data-performance-host-key="suspendHostTurnstileInBackground"]',
		)?.closest<HTMLElement>('.ldp-setting-row')?.dataset.settingHelp
			?.includes('不会读取或保存令牌') &&
		host.querySelector('[data-performance-preset="balanced"]')
			?.classList.contains('active') &&
		host.querySelector('[data-performance-preset="high"]')?.textContent ===
			'快速预取（实验）' &&
		host.querySelector('[data-performance-preset="high"]')
			?.getAttribute('data-performance-risk') === 'experimental' &&
		host.querySelector('[data-performance-preset="high"]')
			?.getAttribute('data-setting-help')?.includes('可能增加卡顿或 429') &&
		[...host.querySelectorAll<HTMLElement>('.ldp-performance-preset')]
			.every((button) => Boolean(button.dataset.settingHelp)) &&
		[...host.querySelectorAll<HTMLElement>('.ldp-performance-fields .ldp-setting-row')]
			.every((row) => Boolean(row.dataset.settingHelp)) &&
		host.querySelector('[data-performance-key="pageSize"]')
			?.closest<HTMLElement>('.ldp-setting-row')?.dataset.settingHelp ===
			'posts.json 单批 post_ids 目标上限。近窗最多两批；后台单飞，可见缺口复用在途请求。共享许可不变，生效批次见性能记录。' &&
		host.querySelector('[data-performance-key="streamMaxItems"]')
			?.closest<HTMLElement>('.ldp-setting-row')
			?.querySelector('.ldp-performance-copy strong')?.textContent ===
			'同时保留楼层目标上限' &&
		host.querySelector('[data-performance-key="streamOverscanViewports"]')
			?.closest<HTMLElement>('.ldp-setting-row')?.dataset.settingHelp ===
			'在当前屏幕前后额外保留多少屏楼层元素；树内与一级楼层共用同一窗口，并受“同时保留楼层目标上限”约束。' &&
		host.querySelector('[data-performance-key="nestedPrefetchViewports"]')
			?.closest<HTMLElement>('.ldp-setting-row')?.dataset.settingHelp ===
			'同一距离提升正文并触发 replies.json 候选；后台单飞，树状最多两路，只提前取数。' &&
		host.querySelector('[data-settings-category="performance-request"]')
			?.querySelector('.ldp-settings-category-head small')?.textContent ===
			'这里只设置目标上限；后台仍须空闲单飞，并让位于前台、活动请求和共享窗口。' &&
		host.querySelector('[data-performance-key="requestMinInterval"]')
			?.closest<HTMLElement>('.ldp-setting-row')?.dataset.settingHelp
			?.includes('不改写全局设置') &&
		host.querySelector('[data-performance-key="requestRateTarget"]')
			?.closest<HTMLElement>('.ldp-setting-row')?.dataset.settingHelp
			?.includes('不自动改写设置') &&
		host.querySelector('[data-performance-preset="low"]')
			?.getAttribute('data-setting-help')?.includes('后台单飞') &&
		host.querySelector('.ldp-performance-status')?.textContent
			?.includes('正文每批不超过 48 楼') &&
		host.querySelector('.ldp-performance-status')?.textContent
			?.includes('后台请求空闲单飞') &&
		host.querySelector('.ldp-performance-status')?.textContent
			?.includes('树状最多 2 路') &&
		host.querySelector('.ldp-performance-status')?.textContent
			?.includes('生效批次与 DOM 见性能记录') &&
		host.querySelector('.ldp-performance-status')?.textContent
			?.includes('请求实际值见请求记录') &&
		!host.querySelector('.ldp-performance-status')?.classList
			.contains('is-risk') &&
		controller.snapshot.draftCount === 0,
	'性能 form 必须复用旧设计语言呈现 4 个预设、4 组 7 字段，并从规范化偏好初始化',
);

const pageSize = host.querySelector<HTMLInputElement>(
	'[data-performance-key="pageSize"]',
)!;
pageSize.value = '56';
pageSize.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
assert(
	Number(controller.snapshot.draftCount) === 1 &&
		host.querySelector('[data-performance-preset="custom"]')
			?.classList.contains('active') &&
		host.querySelector('[data-performance-preset="custom"]')
			?.getAttribute('data-performance-risk') === 'experimental' &&
		host.querySelector('.ldp-performance-status')?.classList
			.contains('is-risk') &&
		host.querySelector('.ldp-performance-status')?.textContent
			?.includes('可能增加卡顿或 429'),
	'手工修改必须只进入 performance draft，并从公共模型推导为自定义预设',
);
const customSave = controller.saveAll();
assert(
	customSave.kind === 'saved' &&
		customSave.count === 1 &&
		updateCount === 1 &&
		preferences.performancePageSize === 56 &&
		preferences.performancePreset === 'custom' &&
		controller.snapshot.draftCount === 0,
	'性能 form 保存必须经 Settings controller 一次提交公共 schema patch',
);

host.querySelector<HTMLButtonElement>(
	'[data-performance-preset="low"]',
)!.click();
assert(
	controller.snapshot.draftCount > 0 &&
		host.querySelector('[data-performance-preset="low"]')
			?.getAttribute('aria-pressed') === 'true' &&
		!host.querySelector('.ldp-performance-status')?.classList
			.contains('is-risk'),
	'预设按钮必须批量更新同一份草稿，不能逐字段写 preference',
);
const lowSave = controller.saveAll();
assert(
	lowSave.kind === 'saved' &&
		Number(updateCount) === 2 &&
		String(preferences.performancePreset) === 'low' &&
		preferences.performanceRequestConcurrency === 2,
	'完整预设必须只产生一个 preference revision',
);

pageSize.value = '1000';
pageSize.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
const invalidSave = controller.saveAll();
assert(
	invalidSave.kind === 'invalid' &&
		invalidSave.issues.performance?.[0]?.includes('12–64') &&
		Number(updateCount) === 2 &&
		Number(controller.snapshot.draftCount) === 1 &&
		host.querySelector('.ldp-performance-status')?.textContent
			?.includes('不会保存'),
	'越界值必须保留草稿并阻止写入，不能依赖浏览器 number input 静默纠正',
);

controller.discardAll();
assert(
	pageSize.value === '24' &&
		controller.snapshot.draftCount === 0,
	'放弃必须从 controller 提供的同一当前偏好快照恢复全部性能字段',
);
pageSize.value = '32';
pageSize.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
assert(
	host.querySelector('[data-performance-preset="custom"]')
		?.classList.contains('active') &&
	!host.querySelector('[data-performance-preset="custom"]')
		?.hasAttribute('data-performance-risk') &&
	!host.querySelector('.ldp-performance-status')?.classList
		.contains('is-risk'),
	'不高于自动档的保守自定义不能被误标为卡顿或 429 风险',
);
controller.discardAll();
preferences = Object.freeze({
	...preferences,
	performancePreset: 'high',
	performancePageSize: 64,
	performanceStreamOverscan: 2,
	performanceStreamMaxItems: 96,
	performanceNestedPrefetch: 3,
	performanceRequestConcurrency: 4,
	performanceRequestInterval: 80,
	performanceRequestRateTarget: 90,
});
preferenceChanges.emit(preferences);
assert(
	String(pageSize.value) === '64' &&
		host.querySelector('[data-performance-preset="high"]')
			?.classList.contains('active') &&
		host.querySelector('.ldp-performance-status')?.classList
			.contains('is-risk') &&
		host.querySelector('.ldp-performance-status')?.textContent
			?.includes('不确定时请使用自动（推荐）') &&
		controller.snapshot.draftCount === 0,
	'无本地草稿时外部 preference change 必须原地更新同一 form，不重建 DOM',
);

pageSize.value = '32';
pageSize.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
preferences = Object.freeze({
	...preferences,
	performanceRequestConcurrency: 2,
});
preferenceChanges.emit(preferences);
const requestConcurrency = host.querySelector<HTMLInputElement>(
	'[data-performance-key="requestMaxConcurrent"]',
)!;
assert(
	pageSize.value === '32' &&
		requestConcurrency.value === '2' &&
		Number(controller.snapshot.draftCount) === 1,
	'有局部草稿时外部 preference change 必须只保留脏字段，并把未编辑字段 rebase 到新快照',
);
const rebasedSave = controller.saveAll();
assert(
	rebasedSave.kind === 'saved' &&
		preferences.performancePageSize === 32 &&
		preferences.performanceRequestConcurrency === 2,
	'局部草稿保存不得用旧表单值覆盖同期外部更新',
);

const suspendHostTurnstile = host.querySelector<HTMLInputElement>(
	'[data-performance-host-key="suspendHostTurnstileInBackground"]',
)!;
suspendHostTurnstile.checked = true;
suspendHostTurnstile.dispatchEvent(
	new parsedWindow.Event('change', { bubbles: true }),
);
assert(
	Number(controller.snapshot.draftCount) === 1 &&
	!preferences.performanceSuspendHostTurnstileInBackground,
	'宿主后台资源开关必须先进入同一性能设置草稿，不能即时改写偏好',
);
const suspendSave = controller.saveAll();
assert(
	suspendSave.kind === 'saved' &&
	preferences.performanceSuspendHostTurnstileInBackground &&
	controller.snapshot.draftCount === 0,
	'实验开关必须与七个性能目标共用 Settings controller 保存入口',
);
preferences = Object.freeze({
	...preferences,
	performanceSuspendHostTurnstileInBackground: false,
});
preferenceChanges.emit(preferences);
assert(
	!suspendHostTurnstile.checked && controller.snapshot.draftCount === 0,
	'无本地草稿时外部配置或 WebDAV 偏好更新必须热应用实验开关',
);

form.destroy();
controller.destroy();
assert(
	host.childElementCount === 0 &&
		preferenceChanges.size === 0,
	'性能 form 销毁必须注销 draft/event owner 并释放自己的 DOM',
);
