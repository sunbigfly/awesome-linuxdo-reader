import { parseHTML } from 'linkedom';
import { Signal } from '../src/kernel/signal.js';
import {
	applyBoostCopyRule,
	normalizeBoostCopySettings,
	readerPreferencesBoostCopyAdapter,
} from '../src/post/boost-copy-rule.js';
import {
	ReaderInteractionSettingsForm,
} from '../src/settings/reader-interaction-settings-form.js';
import {
	readerPreferencesTopicActionRailAdapter,
} from '../src/post/reader-topic-action-rail.js';
import {
	readerPreferencesReplyTreeAdapter,
} from '../src/topic/reader-reply-tree-preferences.js';
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

const counter = normalizeBoostCopySettings({
	mode: 'counter',
	prefix: '赞同：',
	counterMarker: '+',
	counterStep: 2,
});
const first = applyBoostCopyRule('原 Boost', counter);
const second = applyBoostCopyRule(first, counter);
assert(
	first === '赞同：原 Boost+2' &&
		second === '赞同：原 Boost+4',
	'递增规则必须从已有尾巴推导下一次数字，不能维护页面级隐藏计数器',
);
const numericMarker = normalizeBoostCopySettings({
	mode: 'counter',
	counterMarker: '1',
	counterStep: 1,
});
let numericMarkerValue = '版本1';
for (let index = 0; index < 20; index += 1) {
	numericMarkerValue = applyBoostCopyRule(
		numericMarkerValue,
		numericMarker,
	);
}
assert(
	numericMarker.counterMarker === '+' &&
		numericMarkerValue === '版本1+20',
	`无状态规则必须拒绝与 counter 无法区分的数字结尾 marker：${numericMarker.counterMarker}/${numericMarkerValue}`,
);
const fixed = normalizeBoostCopySettings({
	mode: 'text',
	prefix: '同意：',
	fixedSuffix: '俺也一样',
});
const fixedFirst = applyBoostCopyRule('一段很长的 Boost 正文', fixed);
assert(
	[...fixedFirst].length <= 16 &&
		applyBoostCopyRule(fixedFirst, fixed) === fixedFirst,
	'固定尾巴必须保持幂等，并按 Unicode codepoint 限制最终 16 字',
);
const normalized = normalizeBoostCopySettings({
	mode: 'counter',
	counterMarker: ' ',
	counterStep: 1_000,
	prefix: '😀'.repeat(20),
});
assert(
	normalized.counterMarker === '+' &&
		normalized.counterStep === 99 &&
		[...normalized.prefix].length === 16,
	'空 marker、越界步长和多码点文本必须由唯一规则规范化',
);

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body><section id="settings"></section></body></html>',
);
const document = parsedDocument as unknown as Document;
let preferences = createReaderPreferencesDefaults({
	viewportWidth: 1_440,
	viewportHeight: 900,
});
const changes = new Signal<Readonly<ReaderPreferences>>();
let updates = 0;
const treePreviews: number[] = [];
const controller = new ReaderSettingsController<ReaderPreferences>({
	preferences: {
		read: () => preferences,
		update(patch) {
			updates += 1;
			preferences = Object.freeze({ ...preferences, ...patch });
			changes.emit(preferences);
			return preferences;
		},
	},
	initialPanelId: 'interaction',
});
const host = document.querySelector<HTMLElement>('#settings')!;
const form = new ReaderInteractionSettingsForm({
	document,
	host,
	controller,
	boostCopy: readerPreferencesBoostCopyAdapter,
	topicActionRail: readerPreferencesTopicActionRailAdapter,
	replyTree: readerPreferencesReplyTreeAdapter,
	boostsAvailable: false,
	replyTreePreview: {
		update(value) {
			treePreviews.push(value.inlineReplyTreeMaxDepth ?? 1);
			return true;
		},
	},
	readPreferences: () => preferences,
	preferenceChanges: changes,
});
const interactionGroupTitles = [...host.querySelectorAll<HTMLElement>(
	'.ldp-settings-category-head > span > strong,' +
		'.ldp-settings-category-head > strong',
)].map((title) => title.textContent);
const treeOptionLabels = [...host.querySelectorAll<HTMLOptionElement>(
	'.ldp-inline-reply-tree-depth option',
)].map((option) => option.textContent).join('|');
assert(
	host.querySelectorAll('.ldp-boost-rule-control').length === 5 &&
		host.querySelectorAll('.ldp-boost-counter-row').length === 2 &&
		host.querySelector(
			'.ldp-boost-copy-preview-row.ldp-boost-rule-row',
		) !== null &&
		host.querySelector('.ldp-boost-rule-preview small')?.textContent ===
			'最多 16 字' &&
		host.querySelector<HTMLElement>(
			'.ldp-boost-settings-availability',
		)?.hidden === true &&
		[...host.querySelectorAll<HTMLElement>('.ldp-boost-rule-row')]
			.every((row) => Boolean(row.dataset.settingHelp)) &&
		host.querySelectorAll('.ldp-inline-reply-tree-depth option').length === 5 &&
		interactionGroupTitles.join('|') ===
			'主帖操作列|二级回复显示位置|复制 Boost 文本' &&
		treeOptionLabels ===
			'完整讨论窗口|树状嵌套 · 2 层|树状嵌套 · 3 层|' +
			'树状嵌套 · 4 层|树状嵌套 · 5 层' &&
		host.querySelector<HTMLInputElement>(
			'.ldp-expand-leaf-nested-replies',
		)?.closest<HTMLElement>('.ldp-setting-row')?.hidden === true &&
		host.querySelector<HTMLInputElement>(
			'.ldp-hide-nested-reply-floors',
		)?.closest<HTMLElement>('.ldp-setting-row')?.hidden === true &&
		Number(controller.snapshot.draftCount) === 0,
	'帖子与回复面板必须复用单一 form，并对齐主脚本分组、树选项与兼容字段可见性',
);
const treeDepth = host.querySelector<HTMLSelectElement>(
	'.ldp-inline-reply-tree-depth',
)!;
for (const option of [...treeDepth.options]) {
	option.selected = option.value === '5';
}
treeDepth.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
const expandNested = host.querySelector<HTMLInputElement>(
	'.ldp-expand-nested-replies-default',
)!;
expandNested.checked = false;
expandNested.dispatchEvent(
	new parsedWindow.Event('change', { bubbles: true }),
);
assert(
	Number(controller.snapshot.draftCount) === 4 &&
		treePreviews.at(0) === 5 &&
		treePreviews.at(-1) === 5 &&
		host.querySelector<HTMLInputElement>(
			'.ldp-expand-leaf-nested-replies',
		)?.checked === true &&
		host.querySelector<HTMLInputElement>(
			'.ldp-aggregate-descendant-replies',
		)?.checked === false &&
		treeDepth.disabled,
	'树设置必须即时更新投影预览；关闭父楼层展开还要在同一草稿中关闭深层树并保留正式楼层',
);
controller.discardAll();
assert(
	Number(controller.snapshot.draftCount) === 0 &&
		treePreviews.at(-1) === 3 &&
		!treeDepth.disabled &&
		expandNested.checked &&
		host.querySelector<HTMLInputElement>(
			'.ldp-aggregate-descendant-replies',
		)?.checked === true,
	'放弃树设置必须从同一偏好仓恢复默认三层树状嵌套策略',
);

const mode = host.querySelector<HTMLSelectElement>('.ldp-boost-copy-mode')!;
for (const option of [...mode.options]) option.selected = false;
[...mode.options].find((option) => option.value === 'text')!.selected = true;
mode.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
const prefix = host.querySelector<HTMLInputElement>(
	'.ldp-boost-copy-prefix',
)!;
prefix.value = '同意：';
prefix.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
const suffix = host.querySelector<HTMLInputElement>(
	'.ldp-boost-copy-fixed-suffix',
)!;
suffix.value = '俺也一样';
suffix.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
assert(
	Number(controller.snapshot.draftCount) === 3 &&
		host.querySelector<HTMLElement>('.ldp-boost-text-row')?.hidden ===
			false &&
		host.querySelector<HTMLElement>('.ldp-boost-counter-row')?.hidden ===
			true &&
		host.querySelector('.ldp-boost-copy-preview')?.textContent ===
			'同意：原 Boost俺也一样',
	'模式、前缀和尾巴必须进入同一草稿并即时复用正式规则预览',
);
const saved = controller.saveAll();
assert(
	saved.kind === 'saved' &&
		saved.count === 3 &&
		updates === 1 &&
		preferences.boostCopyMode === 'text' &&
		preferences.boostCopyPrefix === '同意：' &&
		preferences.boostCopyFixedSuffix === '俺也一样' &&
		Number(controller.snapshot.draftCount) === 0,
	'Boost 规则必须随全部设置一次 revision 保存，不能保留旧即时 setPrefs',
);

const stableSnapshot = controller.snapshot;
preferences = Object.freeze({
	...preferences,
	themeMode: preferences.themeMode === 'light' ? 'dark' : 'light',
});
changes.emit(preferences);
assert(
	controller.snapshot === stableSnapshot,
	'无关偏好变化不得刷新 interaction 草稿状态',
);

for (const option of [...mode.options]) option.selected = false;
[...mode.options].find((option) => option.value === 'counter')!.selected = true;
mode.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
const marker = host.querySelector<HTMLInputElement>(
	'.ldp-boost-copy-counter-marker',
)!;
marker.value = '1';
marker.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
const invalidMarker = controller.saveAll();
assert(
	invalidMarker.kind === 'invalid' && updates === 1,
	'counter marker 以数字结尾时必须明确阻止保存，避免无状态计数边界歧义',
);
marker.value = '+';
marker.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
const step = host.querySelector<HTMLInputElement>(
	'.ldp-boost-copy-counter-step',
)!;
step.value = '0';
step.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
const invalid = controller.saveAll();
assert(
	invalid.kind === 'invalid' &&
		updates === 1 &&
		Number(controller.snapshot.draftCount) === 2,
	'越界递增步长必须阻止整个统一保存且保留可修正草稿',
);
for (const option of [...mode.options]) option.selected = false;
[...mode.options].find((option) => option.value === 'text')!.selected = true;
mode.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
const textSaved = controller.saveAll();
assert(
	textSaved.kind === 'saved' &&
		Number(updates) === 2 &&
		preferences.boostCopyMode === 'text' &&
		preferences.boostCopyCounterStep === 1,
	'切到固定文字模式后，隐藏且不参与规则的无效 counter 步长不得阻断统一保存',
);
prefix.value = '临时：';
prefix.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
controller.discardAll();
assert(
	Number(controller.snapshot.draftCount) === 0 &&
		mode.value === 'text' &&
		step.value === '1' &&
		prefix.value === '同意：',
	'放弃必须从同一持久偏好恢复全部 Boost 控件',
);

preferences = Object.freeze({
	...preferences,
	topicActionRailPosition: Object.freeze({ x: 0.4, y: 0.5 }),
});
changes.emit(preferences);
const railVisible = host.querySelector<HTMLInputElement>(
	'.ldp-topic-action-rail-visible-setting',
)!;
const railFixed = host.querySelector<HTMLInputElement>(
	'.ldp-topic-action-rail-fixed-setting',
)!;
const railReset = host.querySelector<HTMLButtonElement>(
	'.ldp-topic-action-rail-reset',
)!;
assert(
	railVisible.checked &&
		!railFixed.checked &&
		!railReset.disabled &&
		Number(controller.snapshot.draftCount) === 0,
	'外部操作列位置变化必须经同一 interaction 草稿 rebase，不能制造未保存状态',
);
railVisible.checked = false;
railVisible.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
railFixed.checked = true;
railFixed.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
railReset.click();
assert(
	Number(controller.snapshot.draftCount) === 3 &&
		railReset.disabled,
	'显示、锁定和恢复位置必须进入同一帖子与回复草稿',
);
const railSaved = controller.saveAll();
assert(
	railSaved.kind === 'saved' &&
		railSaved.count === 3 &&
		Number(updates) === 3 &&
		!preferences.topicActionRailVisible &&
		preferences.topicActionRailFixed &&
		preferences.topicActionRailPosition.x === 'left' &&
		preferences.topicActionRailPosition.y === 0.95,
	'操作列设置必须与 Boost 规则复用一次 Settings/application 写事务',
);

form.destroy();
controller.destroy();
assert(!host.firstChild, '销毁 interaction form 必须释放 DOM 和草稿注册');
