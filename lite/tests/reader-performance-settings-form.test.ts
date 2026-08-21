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
	host.querySelectorAll('.ldp-performance-preset').length === 0 &&
		host.querySelectorAll('.ldp-settings-category-group').length === 8 &&
		host.querySelectorAll('[data-performance-key]').length === 9 &&
		host.querySelectorAll('[data-request-flow-key]').length === 12 &&
		host.querySelector<HTMLInputElement>(
			'[data-request-flow-key="backgroundIdleIntervalMs"]',
		)?.value === '2500' &&
		host.querySelector<HTMLInputElement>(
			'[data-request-flow-key="standardMaxConcurrent"]',
		)?.value === '1' &&
		host.querySelectorAll('[data-request-business]').length === 4 &&
		host.querySelectorAll('[data-request-business-key]').length === 12 &&
		host.querySelector<HTMLInputElement>(
			'[data-request-business-key="topic-download.maxConcurrent"]',
		)?.value === '1' &&
		host.querySelector<HTMLInputElement>(
			'[data-request-business-key="bookmarks.backgroundRequestsPerMinute"]',
		)?.value === '40' &&
		host.querySelector('[data-request-business="topic-download"]')
			?.textContent?.includes('canonical Topic') &&
		host.querySelector('[data-request-business="notifications"]')
			?.textContent?.includes('头页批次 · 历史顺序') &&
		host.querySelector('[data-request-business="bookmarks"]')
			?.textContent?.includes('写入 关键 · 429 重试 0') &&
		[...host.querySelectorAll<HTMLElement>('[data-request-business]')]
			.every((row) => row.dataset.settingHelp?.includes('共享全局 10 秒/60 秒许可')) &&
		host.querySelector<HTMLInputElement>(
			'[data-performance-host-key="hostTopicPreheatPostCount"]',
		)?.value === '24' &&
		!host.querySelector(
			'[data-performance-host-key="hostTopicPreheatPostCount"]',
		)?.closest<HTMLElement>('.ldp-setting-row')?.hidden &&
		host.querySelector<HTMLInputElement>(
			'[data-performance-host-key="hostTopicPreheatEnabled"]',
		)?.checked &&
		!host.querySelector<HTMLInputElement>(
			'[data-performance-host-key="suspendHostTurnstileInBackground"]',
		)?.checked &&
		host.querySelector(
			'[data-settings-category="performance-host-runtime"]',
		)?.textContent?.includes('宿主列表与后台资源') &&
		host.querySelector(
			'[data-performance-host-key="hostTopicPreheatEnabled"]',
		)?.closest<HTMLElement>('.ldp-setting-row')?.dataset.settingHelp
			?.includes('当前正在阅读的同一 Topic 不重复预热') &&
		host.querySelector(
			'[data-performance-host-key="suspendHostTurnstileInBackground"]',
		)?.closest<HTMLElement>('.ldp-setting-row')?.dataset.settingHelp
			?.includes('不会读取或保存令牌') &&
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
		host.querySelector('[data-settings-category="performance-request-flow"]')
			?.textContent?.includes('过去写死的后台让路、预取窗口和车道并发') &&
		host.querySelector('[data-request-flow-key="standardMaxConcurrent"]')
			?.closest<HTMLElement>('.ldp-setting-row')?.dataset.settingHelp
			?.includes('业务自身的顺序') &&
		host.querySelector('[data-performance-key="readStateRequestsPerMinute"]')
			?.closest<HTMLElement>('.ldp-setting-row')?.dataset.settingHelp
			?.includes('全站 10 秒/60 秒共享窗口') &&
		host.querySelector('[data-performance-key="readStateTimingsPerMinute"]')
			?.closest<HTMLElement>('.ldp-setting-row')?.dataset.settingHelp
			?.includes('不是 token') &&
		host.querySelector('.ldp-performance-status')?.textContent
			?.includes('正文每批不超过 32 楼') &&
		host.querySelector('.ldp-performance-status')?.textContent
			?.includes('后台请求空闲单飞') &&
		host.querySelector('.ldp-performance-status')?.textContent
			?.includes('树状最多 2 路') &&
		host.querySelector('.ldp-performance-status')?.textContent
			?.includes('生效批次与 DOM 见性能记录') &&
		host.querySelector('.ldp-performance-status')?.textContent
			?.includes('请求实际值见请求记录') &&
		host.querySelector('.ldp-performance-status')?.textContent
			?.includes(
				'已读队列 10 RPM / 240 TPM，宿主列表预热开启（每个 Topic 最多 24 层、2 路）',
			) &&
		!host.querySelector('.ldp-performance-status')?.classList
			.contains('is-risk') &&
		controller.snapshot.draftCount === 0,
	'性能 form 必须显性提供九项全局、十二项请求流、十二项业务参数与宿主设置',
);

const pageSize = host.querySelector<HTMLInputElement>(
	'[data-performance-key="pageSize"]',
)!;
pageSize.value = '56';
pageSize.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
assert(
	Number(controller.snapshot.draftCount) === 1 &&
		host.querySelector('.ldp-performance-status')?.classList
			.contains('is-risk') &&
		host.querySelector('.ldp-performance-status')?.textContent
			?.includes('可能增加卡顿或 429'),
	'高于默认值的手工修改必须只进入 performance draft 并显示风险提示',
);
const customSave = controller.saveAll();
assert(
	customSave.kind === 'saved' &&
		customSave.count === 1 &&
		updateCount === 1 &&
		preferences.performancePageSize === 56 &&
		preferences.performancePreset === 'custom' &&
		controller.snapshot.draftCount === 0,
	'性能 form 保存必须经 Settings controller 一次提交公共 schema patch，并保留旧配置兼容标记',
);

pageSize.value = '1000';
pageSize.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
const invalidSave = controller.saveAll();
assert(
	invalidSave.kind === 'invalid' &&
		invalidSave.issues.performance?.[0]?.includes('12–64') &&
		Number(updateCount) === 1 &&
		Number(controller.snapshot.draftCount) === 1 &&
		host.querySelector('.ldp-performance-status')?.textContent
			?.includes('不会保存'),
	'越界值必须保留草稿并阻止写入，不能依赖浏览器 number input 静默纠正',
);

controller.discardAll();
assert(
	pageSize.value === '56' &&
		controller.snapshot.draftCount === 0,
	'放弃必须从 controller 提供的同一当前偏好快照恢复全部性能字段',
);
pageSize.value = '28';
pageSize.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
assert(
	!host.querySelector('.ldp-performance-status')?.classList
		.contains('is-risk'),
	'不高于默认值的保守自定义不能被误标为卡顿或 429 风险',
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
	performanceReadStateRequestsPerMinute: 20,
	performanceReadStateTimingsPerMinute: 400,
});
preferenceChanges.emit(preferences);
assert(
	String(pageSize.value) === '64' &&
		host.querySelector('.ldp-performance-status')?.classList
			.contains('is-risk') &&
		host.querySelector('.ldp-performance-status')?.textContent
			?.includes('不确定时请恢复默认') &&
		controller.snapshot.draftCount === 0,
	'无本地草稿时外部 preference change 必须原地更新同一 form，不重建 DOM',
);
host.querySelector<HTMLButtonElement>('.ldp-performance-reset')!.click();
const hostTopicPreheatPostCount = host.querySelector<HTMLInputElement>(
	'[data-performance-host-key="hostTopicPreheatPostCount"]',
)!;
assert(
	pageSize.value === '32' &&
		hostTopicPreheatPostCount.value === '24' &&
		Number(controller.snapshot.draftCount) === 9 &&
		!host.querySelector('.ldp-performance-status')?.classList
			.contains('is-risk'),
	'恢复默认必须一次写回当前九项默认参数、流控基线与 24 层预热基线',
);
const defaultSave = controller.saveAll();
assert(
	defaultSave.kind === 'saved' &&
		Number(updateCount) === 2 &&
		preferences.performancePreset === 'balanced' &&
		preferences.performancePageSize === 32 &&
		preferences.hostTopicPreheatPostCount === 24 &&
		!preferences.performanceSuspendHostTurnstileInBackground,
	'默认参数必须经同一保存事务落盘并继续兼容旧 performancePreset 字段',
);

pageSize.value = '28';
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
	pageSize.value === '28' &&
		requestConcurrency.value === '2' &&
		Number(controller.snapshot.draftCount) === 1,
	'有局部草稿时外部 preference change 必须只保留脏字段，并把未编辑字段 rebase 到新快照',
);
const rebasedSave = controller.saveAll();
assert(
	rebasedSave.kind === 'saved' &&
		preferences.performancePageSize === 28 &&
		preferences.performanceRequestConcurrency === 2,
	'局部草稿保存不得用旧表单值覆盖同期外部更新',
);

const hostTopicPreheat = host.querySelector<HTMLInputElement>(
	'[data-performance-host-key="hostTopicPreheatEnabled"]',
)!;
hostTopicPreheatPostCount.value = '64';
hostTopicPreheatPostCount.dispatchEvent(
	new parsedWindow.Event('input', { bubbles: true }),
);
assert(
	Number(controller.snapshot.draftCount) === 1 &&
	preferences.hostTopicPreheatPostCount === 24 &&
	host.querySelector('.ldp-performance-status')?.classList.contains('is-risk'),
	'预热楼层数必须先进入草稿，高于 24 层默认值时显示负载风险',
);
const preheatPostCountSave = controller.saveAll();
assert(
	preheatPostCountSave.kind === 'saved' &&
	Number(preferences.hostTopicPreheatPostCount) === 64 &&
	controller.snapshot.draftCount === 0,
	'预热楼层数必须与其他性能设置共用一次保存入口',
);
hostTopicPreheatPostCount.value = '129';
hostTopicPreheatPostCount.dispatchEvent(
	new parsedWindow.Event('input', { bubbles: true }),
);
const invalidPreheatPostCountSave = controller.saveAll();
assert(
	invalidPreheatPostCountSave.kind === 'invalid' &&
		invalidPreheatPostCountSave.issues.performance?.[0]?.includes('1–128') &&
		Number(preferences.hostTopicPreheatPostCount) === 64,
	'越界预热楼层数必须阻止整个性能草稿保存',
);
controller.discardAll();
assert(
	hostTopicPreheatPostCount.value === '64' &&
		controller.snapshot.draftCount === 0,
	'放弃无效预热楼层数后必须恢复已保存值',
);
hostTopicPreheat.checked = false;
hostTopicPreheat.dispatchEvent(
	new parsedWindow.Event('change', { bubbles: true }),
);
assert(
	Number(controller.snapshot.draftCount) === 1 &&
	preferences.hostTopicPreheatEnabled &&
	hostTopicPreheatPostCount.closest<HTMLElement>('.ldp-setting-row')?.hidden,
	'宿主 Topic 预热开关必须先进入同一性能设置草稿，不能即时改写偏好',
);
const hostPreheatSave = controller.saveAll();
assert(
	hostPreheatSave.kind === 'saved' &&
	!preferences.hostTopicPreheatEnabled &&
	controller.snapshot.draftCount === 0,
	'宿主 Topic 预热开关必须与性能目标共用 Settings controller 保存入口',
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
	'实验开关必须与全局及业务性能目标共用 Settings controller 保存入口',
);

const topicDownloadRpm = host.querySelector<HTMLInputElement>(
	'[data-request-business-key="topic-download.backgroundRequestsPerMinute"]',
)!;
topicDownloadRpm.value = '45';
topicDownloadRpm.dispatchEvent(
	new parsedWindow.Event('input', { bubbles: true }),
);
assert(
	Number(controller.snapshot.draftCount) === 1 &&
	preferences.businessRequestSettings['topic-download']
		.backgroundRequestsPerMinute === 24 &&
	host.querySelector('.ldp-performance-status')?.classList.contains('is-risk'),
	'业务后台 RPM 必须先进入统一草稿，提高默认值时显示 429 风险',
);
const businessSave = controller.saveAll();
assert(
	businessSave.kind === 'saved' &&
	Number(preferences.businessRequestSettings['topic-download']
		.backgroundRequestsPerMinute) === 45 &&
	controller.snapshot.draftCount === 0,
	'业务请求参数必须经同一设置事务持久化并由 preference change 热应用',
);
const standardLaneConcurrency = host.querySelector<HTMLInputElement>(
	'[data-request-flow-key="standardMaxConcurrent"]',
)!;
standardLaneConcurrency.value = '2';
standardLaneConcurrency.dispatchEvent(
	new parsedWindow.Event('input', { bubbles: true }),
);
assert(
	Number(controller.snapshot.draftCount) === 1 &&
	preferences.requestFlowSettings.standardMaxConcurrent === 1 &&
	host.querySelector('.ldp-performance-status')?.classList.contains('is-risk'),
	'请求流参数必须先进入统一草稿，提高默认车道并发时显示风险',
);
const requestFlowSave = controller.saveAll();
assert(
	requestFlowSave.kind === 'saved' &&
	Number(preferences.requestFlowSettings.standardMaxConcurrent) === 2 &&
	controller.snapshot.draftCount === 0,
	'请求流参数必须经同一设置事务持久化并由 preference change 热应用',
);
const backgroundIdleInterval = host.querySelector<HTMLInputElement>(
	'[data-request-flow-key="backgroundIdleIntervalMs"]',
)!;
backgroundIdleInterval.value = '10001';
backgroundIdleInterval.dispatchEvent(
	new parsedWindow.Event('input', { bubbles: true }),
);
const invalidRequestFlowSave = controller.saveAll();
assert(
	invalidRequestFlowSave.kind === 'invalid' &&
	invalidRequestFlowSave.issues.performance?.some((issue) =>
		issue.includes('后台空闲启动间隔')) &&
	preferences.requestFlowSettings.backgroundIdleIntervalMs === 2_500,
	'越界请求流目标必须阻止整个性能设置事务',
);
controller.discardAll();
const notificationInterval = host.querySelector<HTMLInputElement>(
	'[data-request-business-key="notifications.backgroundMinIntervalMs"]',
)!;
notificationInterval.value = '79';
notificationInterval.dispatchEvent(
	new parsedWindow.Event('input', { bubbles: true }),
);
const invalidBusinessSave = controller.saveAll();
assert(
	invalidBusinessSave.kind === 'invalid' &&
	invalidBusinessSave.issues.performance?.some((issue) =>
		issue.includes('用户通知后台最小间隔')) &&
	preferences.businessRequestSettings.notifications
		.backgroundMinIntervalMs === 100,
	'越界业务请求参数必须阻止整个性能设置事务，不能只修正 DOM 数值',
);
controller.discardAll();
preferences = Object.freeze({
	...preferences,
	hostTopicPreheatEnabled: true,
	hostTopicPreheatPostCount: 24,
	performanceSuspendHostTurnstileInBackground: false,
	requestFlowSettings: Object.freeze({
		...preferences.requestFlowSettings,
		standardMaxConcurrent: 3,
	}),
	businessRequestSettings: Object.freeze({
		...preferences.businessRequestSettings,
		'topic-download': Object.freeze({
			...preferences.businessRequestSettings['topic-download'],
			backgroundRequestsPerMinute: 30,
		}),
		notifications: Object.freeze({
			...preferences.businessRequestSettings.notifications,
			backgroundMinIntervalMs: 400,
		}),
	}),
});
preferenceChanges.emit(preferences);
assert(
	hostTopicPreheat.checked &&
	String(hostTopicPreheatPostCount.value) === '24' &&
	!hostTopicPreheatPostCount.closest<HTMLElement>('.ldp-setting-row')?.hidden &&
	!suspendHostTurnstile.checked &&
	topicDownloadRpm.value === '30' &&
	standardLaneConcurrency.value === '3' &&
	notificationInterval.value === '400' &&
	controller.snapshot.draftCount === 0,
	'无本地草稿时外部配置或 WebDAV 偏好更新必须热应用宿主、请求流与业务参数',
);

form.destroy();
controller.destroy();
assert(
	host.childElementCount === 0 &&
		preferenceChanges.size === 0,
	'性能 form 销毁必须注销 draft/event owner 并释放自己的 DOM',
);
