import { parseHTML } from 'linkedom';
import { Signal } from '../src/kernel/signal.js';
import {
	ReaderLoadingAnimationView,
} from '../src/motion/reader-loading-animation-view.js';
import {
	ReaderMotionSettingsForm,
	readerPreferencesMotionAdapter,
} from '../src/settings/reader-motion-settings-form.js';
import {
	ReaderSettingsController,
} from '../src/settings/reader-settings-controller.js';
import {
	ReaderShell,
	type ReaderShellView,
	type ReaderTopicFactoryResult,
} from '../src/shell/reader-shell.js';
import {
	createReaderPreferencesDefaults,
	type ReaderPreferences,
} from '../src/state/reader-preferences-schema.js';
import {
	ReaderTopicNavigationPreferenceProjection,
} from '../src/topic/reader-topic-navigation-preferences.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function deferred<T>(): Readonly<{
	readonly promise: Promise<T>;
	readonly resolve: (value: T) => void;
}> {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return Object.freeze({ promise, resolve });
}

function createView(document: Document): ReaderShellView {
	const root = document.createElement('div');
	const modal = document.createElement('section');
	const body = document.createElement('main');
	const topicHost = document.createElement('div');
	const surfaceHost = document.createElement('aside');
	body.append(topicHost);
	modal.append(body, surfaceHost);
	root.append(modal);
	document.body.append(root);
	return Object.freeze({ root, modal, body, topicHost, surfaceHost });
}

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body><section id="settings"></section></body></html>',
);
const document = parsedDocument as unknown as Document;
const view = createView(document);
const shell = new ReaderShell<string>('motion-test', view);
const randomValues = [0, 0.99];
const loading = new ReaderLoadingAnimationView({
	document,
	host: view.body,
	shell,
	preference: 'random',
	siteName: 'Linux Do',
	random: () => randomValues.shift() ?? 0.5,
});
const releaseFirstLoading = loading.begin(1, 12);
const firstGate = deferred<ReaderTopicFactoryResult<string>>();
const firstOpen = shell.open(1, () => firstGate.promise);
const mask = view.body.querySelector<HTMLElement>('.ldp-loadmask')!;
assert(
	!mask.hidden &&
	view.modal.classList.contains('ldp-loadmask-visible') &&
		view.root.getAttribute('aria-busy') === 'true' &&
		mask.querySelector('.ldp-loading-visual')?.getAttribute(
			'data-animation',
		) === 'portal' &&
		mask.querySelector('.ldp-loading-mode')?.textContent ===
			'LINUX DO READER · 主题开卷' &&
		mask.querySelector('.ldp-loading-status span')?.textContent ===
			'正在准备目标楼层' &&
		mask.querySelector('.ldp-loading-target')?.textContent === '#12' &&
		mask.querySelector('.ldp-loading-detail')?.textContent ===
			'正在检查帖子缓存…',
	'Shell opening 必须标记 Reader busy，并显示主线加载阶段、目标楼层、站点名称和首次随机样式',
);
loading.update({
	topicId: 1,
	phase: 'network',
	cachedCount: 4,
	missingCount: 8,
});
assert(
	mask.querySelector('.ldp-loading-status span')?.textContent ===
		'正在请求目标楼层' &&
	mask.querySelector('.ldp-loading-detail')?.textContent ===
		'已读取 4 条缓存，正在下载 8 条缺失楼层…' &&
	mask.querySelector('.ldp-loading-stage')?.getAttribute('aria-label') ===
		'正在请求目标楼层，已读取 4 条缓存，正在下载 8 条缺失楼层',
	'加载来源必须投影主线 network 文案和同步无障碍标签',
);
firstGate.resolve({ value: 'topic-1' });
await firstOpen;
assert(
	!mask.hidden,
	'Topic running 后目标导航未结束时必须由事务 hold 保持加载层',
);
loading.update({ topicId: 1, phase: 'render' });
releaseFirstLoading();
assert(
	mask.hidden &&
		!view.modal.classList.contains('ldp-loadmask-visible') &&
		!view.root.hasAttribute('aria-busy'),
	'目标事务完成后必须隐藏加载层并释放 Reader busy，不能遮挡已挂载正文',
);

const releaseSecondLoading = loading.begin(2);
const secondGate = deferred<ReaderTopicFactoryResult<string>>();
const secondOpen = shell.open(2, () => secondGate.promise);
assert(
	!mask.hidden &&
		mask.querySelector('.ldp-loading-visual')?.getAttribute(
			'data-animation',
		) === 'inkverse',
	'切帖随机样式必须避开上一次结果并复用同一个加载层',
);
loading.apply('corridor');
assert(
	mask.querySelector('.ldp-loading-visual')?.getAttribute(
		'data-animation',
	) === 'corridor',
	'加载过程中变更持久动画偏好必须在同一 view 内更新',
);
secondGate.resolve({ value: 'topic-2' });
await secondOpen;
releaseSecondLoading();

const releaseStaleTarget = loading.begin(2, 7);
const releaseCurrentTarget = loading.begin(2, 9);
releaseStaleTarget();
assert(
	!mask.hidden &&
		mask.querySelector('.ldp-loading-target')?.textContent === '#9',
	'同 Topic 新目标事务开始后，旧 release 不能提前隐藏或回退当前加载层',
);
releaseCurrentTarget();
assert(mask.hidden, '当前目标事务完成后必须正常释放同一个加载层');

let preferences = createReaderPreferencesDefaults({
	viewportWidth: 1_440,
	viewportHeight: 900,
});
const preferenceChanges = new Signal<Readonly<ReaderPreferences>>();
let updates = 0;
const controller = new ReaderSettingsController<ReaderPreferences>({
	preferences: {
		read: () => preferences,
		update(patch) {
			updates += 1;
			preferences = Object.freeze({ ...preferences, ...patch });
			preferenceChanges.emit(preferences);
			return preferences;
		},
	},
	initialPanelId: 'flash',
});
const navigation = new ReaderTopicNavigationPreferenceProjection({
	root: view.root,
	preferences: readerPreferencesMotionAdapter.read(preferences),
});
const stopNavigationSync = preferenceChanges.subscribe((next) => {
	navigation.apply(readerPreferencesMotionAdapter.read(next));
});
const host = document.querySelector<HTMLElement>('#settings')!;
const formRandom = [0.1, 0.9];
const form = new ReaderMotionSettingsForm({
	document,
	host,
	controller,
	navigation,
	preferences: readerPreferencesMotionAdapter,
	readPreferences: () => preferences,
	preferenceChanges,
	random: () => formRandom.shift() ?? 0.4,
});
assert(
	host.querySelectorAll('[data-motion-setting]').length === 5 &&
		host.querySelectorAll('.ldp-loading-animation-select option').length ===
			11 &&
		host.querySelector('.ldp-settings-category-head small')?.textContent ===
			'跳转到指定楼层时，用短暂闪烁帮助定位目标内容。' &&
		[...host.querySelectorAll<HTMLElement>('.ldp-flash-fields .ldp-setting-row')]
			.every((row) => Boolean(row.dataset.settingHelp)) &&
		host.querySelector<HTMLInputElement>('.ldp-flash-radius')
			?.getAttribute('aria-label') === '跳转提示圆角' &&
		host.querySelector<HTMLInputElement>('.ldp-flash-borderWidth')
			?.getAttribute('aria-label') === '跳转提示轮廓宽度' &&
		host.querySelector<HTMLInputElement>('.ldp-flash-rate')
			?.getAttribute('aria-label') === '跳转提示闪烁速度' &&
		host.querySelector<HTMLInputElement>('.ldp-flash-count')
			?.getAttribute('aria-label') === '跳转提示闪烁次数' &&
		host.querySelector('.ldp-flash-color-value')?.textContent ===
			'#0888cc' &&
		[...host.querySelectorAll('.ldp-settings-category-head small')]
			.at(-1)?.textContent ===
			'打开或切换帖子时显示；选择“每次随机”会从 10 种动画中重新抽取。' &&
		controller.snapshot.draftCount === 0,
	'动画设置必须对齐 5 个高亮字段的标题、帮助、标签和值，并呈现随机加 10 个加载样式',
);
const stableSettingsSnapshot = controller.snapshot;
const stableNavigationSnapshot = navigation.snapshot;
preferences = Object.freeze({
	...preferences,
	themeMode: preferences.themeMode === 'light' ? 'dark' : 'light',
});
preferenceChanges.emit(preferences);
assert(
	controller.snapshot === stableSettingsSnapshot &&
		navigation.snapshot === stableNavigationSnapshot,
	'无关偏好不得刷新动画表单或重投导航高亮',
);

const color = host.querySelector<HTMLInputElement>(
	'[data-motion-setting="jumpHighlightColor"]',
)!;
color.value = '#123456';
color.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
const radius = host.querySelector<HTMLInputElement>(
	'[data-motion-setting="jumpHighlightRadius"]',
)!;
radius.value = '18';
radius.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
const select = host.querySelector<HTMLSelectElement>(
	'.ldp-loading-animation-select',
)!;
for (const option of [...select.options]) {
	option.selected = false;
}
[...select.options].find((option) =>
	option.value === 'typewave'
)!.selected = true;
const selectedTypewave = [...select.options].filter(
	(option) => option.selected,
).map((option) => option.value).join(',');
assert(
	selectedTypewave === 'typewave',
	`测试环境必须已选中 typewave，实际为 ${selectedTypewave}`,
);
select.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
assert(
	Number(controller.snapshot.draftCount) === 3,
	'动画设置必须登记颜色、圆角和加载样式三项草稿',
);
assert(
	view.root.style.getPropertyValue('--ldp-jump-highlight-color') ===
		'#123456' &&
	view.root.style.getPropertyValue('--ldp-jump-highlight-radius') === '18px',
	'高亮草稿必须只预览到既有 projection',
);
const previewAnimation = host.querySelector(
	'.ldp-loading-preview-stage .ldp-loading-visual',
)?.getAttribute('data-animation');
assert(
	previewAnimation === 'typewave',
	`加载草稿必须复用正式 renderer，实际为 ${previewAnimation ?? 'missing'}`,
);

const saved = controller.saveAll();
assert(
	saved.kind === 'saved' &&
		saved.count === 3 &&
		updates === 1 &&
		preferences.loadingAnimation === 'typewave' &&
		preferences.jumpHighlightColor === '#123456' &&
		preferences.jumpHighlightRadius === 18 &&
		controller.snapshot.draftCount === 0,
	'动画和高亮必须在统一设置事务中一次保存，不能保留旧即时写路径',
);

for (const option of [...select.options]) {
	option.selected = false;
}
[...select.options].find((option) =>
	option.value === 'random'
)!.selected = true;
select.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
const firstPreview = host.querySelector(
	'.ldp-loading-preview-stage .ldp-loading-visual',
)?.getAttribute('data-animation');
radius.value = '19';
radius.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
assert(
	host.querySelector(
		'.ldp-loading-preview-stage .ldp-loading-visual',
	)?.getAttribute('data-animation') === firstPreview,
	'编辑高亮参数不得让随机动画预览自行换样式',
);
host.querySelector<HTMLButtonElement>(
	'.ldp-loading-preview-reroll',
)!.click();
const secondPreview = host.querySelector(
	'.ldp-loading-preview-stage .ldp-loading-visual',
)?.getAttribute('data-animation');
assert(
	firstPreview !== secondPreview &&
		!host.querySelector<HTMLButtonElement>(
			'.ldp-loading-preview-reroll',
		)!.hidden,
	'随机预览换一个必须避开当前结果且不产生额外偏好写入',
);
controller.discardAll();
assert(
	controller.snapshot.draftCount === 0 &&
		select.value === 'typewave' &&
		view.root.style.getPropertyValue('--ldp-jump-highlight-color') ===
			'#123456',
	'放弃草稿必须恢复持久动画和高亮 CSS，不残留预览状态',
);

form.destroy();
stopNavigationSync();
navigation.destroy();
controller.destroy();
loading.destroy();
shell.destroy();
assert(
	host.childElementCount === 0 &&
		preferenceChanges.size === 0 &&
	!view.root.hasAttribute('aria-busy') &&
	!view.modal.classList.contains('ldp-loadmask-visible') &&
		!mask.isConnected,
	'销毁必须释放设置订阅、加载层、Reader busy 和高亮 CSS owner',
);
