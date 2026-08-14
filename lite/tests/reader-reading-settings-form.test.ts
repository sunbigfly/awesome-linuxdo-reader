import { parseHTML } from 'linkedom';
import { Signal } from '../src/kernel/signal.js';
import {
	ReaderReadingSettingsForm,
	readerPreferencesReadingSettingsAdapter,
} from '../src/settings/reader-reading-settings-form.js';
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
	initialPanelId: 'reading',
});
const form = new ReaderReadingSettingsForm({
	document,
	host,
	controller,
	preferences: readerPreferencesReadingSettingsAdapter,
	readPreferences: () => preferences,
	preferenceChanges,
});

const alwaysVisible = host.querySelector<HTMLInputElement>(
	'.ldp-history-buttons-always-visible-setting',
)!;
const edge = host.querySelector<HTMLInputElement>(
	'.ldp-history-edge-trigger-range',
)!;
const sort = host.querySelector<HTMLSelectElement>(
	'.ldp-history-sort-mode',
)!;
const openFirst = host.querySelector<HTMLInputElement>(
	'.ldp-open-topics-first-post',
)!;
const queueEmpty = host.querySelector<HTMLInputElement>(
	'.ldp-reader-queue-always-visible-empty',
)!;
const doubleEscape = host.querySelector<HTMLInputElement>(
	'.ldp-double-escape-close-reader',
)!;
const confirmComposer = host.querySelector<HTMLInputElement>(
	'.ldp-confirm-native-composer-close',
)!;
const reset = host.querySelector<HTMLButtonElement>(
	'.ldp-settings-form-reset',
)!;
const groupTitles = [...host.querySelectorAll<HTMLElement>(
	'.ldp-settings-category-head > span > strong',
)].map((title) => title.textContent);
const optionRows = [...host.querySelectorAll<HTMLElement>(
	'.ldp-setting-option-row',
)];
assert(
	JSON.stringify(groupTitles) === JSON.stringify([
		'阅读队列入口',
		'历史前进与后退',
		'帖子打开位置',
		'关闭窗口',
	]) &&
		optionRows.length === 7 &&
		optionRows.every((row) => Boolean(row.dataset.settingHelp)) &&
		[...sort.querySelectorAll('option')].map((option) =>
			option.textContent
		).join('|') ===
			'最近打开优先（默认）|首次打开顺序（固定）',
	'阅读设置必须与主脚本保持四组顺序、七行帮助和历史排序选项标签',
);
assert(
	alwaysVisible.checked &&
		edge.value === '15' &&
		edge.disabled &&
		[...sort.querySelectorAll('option')].find((option) =>
			option.hasAttribute('selected'),
		)?.getAttribute('value') ===
			'recent-viewed' &&
		openFirst.checked &&
		queueEmpty.checked &&
		!doubleEscape.checked &&
		!confirmComposer.checked &&
		reset.disabled &&
		controller.snapshot.draftCount === 0,
	`阅读设置必须从统一偏好 schema 初始化四个真实 runtime 字段：` +
		`always=${String(alwaysVisible.checked)}, edge=${edge.value}, ` +
		`edgeDisabled=${String(edge.disabled)}, preferenceSort=${
			preferences.historySortMode
		}, sort=${
			[...sort.querySelectorAll('option')].find((option) =>
				option.hasAttribute('selected'),
			)?.getAttribute('value')
		}, optionValues=${[
			...sort.querySelectorAll('option'),
		].map((option) => option.getAttribute('value')).join(',')}, ` +
		`sortHtml=${sort.outerHTML}, ` +
		`openFirst=${String(openFirst.checked)}, reset=${String(reset.disabled)}`,
);

alwaysVisible.checked = false;
alwaysVisible.dispatchEvent(
	new parsedWindow.Event('change', { bubbles: true }),
);
edge.value = '7';
edge.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
const sortOptions = [...sort.querySelectorAll('option')];
const selectedState = new Map<HTMLOptionElement, boolean>(
	sortOptions.map((option) => [
		option,
		option.getAttribute('value') === 'first-viewed',
	]),
);
for (const option of sortOptions) {
	Object.defineProperty(option, 'selected', {
		configurable: true,
		get: () => selectedState.get(option) === true,
		set: (value: boolean) => {
			selectedState.set(option, value === true);
		},
	});
}
const firstViewed = sortOptions.find(
	(option) => option.getAttribute('value') === 'first-viewed',
)!;
firstViewed.selected = true;
sort.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
openFirst.checked = false;
openFirst.dispatchEvent(
	new parsedWindow.Event('change', { bubbles: true }),
);
queueEmpty.checked = false;
queueEmpty.dispatchEvent(
	new parsedWindow.Event('change', { bubbles: true }),
);
doubleEscape.checked = true;
doubleEscape.dispatchEvent(
	new parsedWindow.Event('change', { bubbles: true }),
);
confirmComposer.checked = true;
confirmComposer.dispatchEvent(
	new parsedWindow.Event('change', { bubbles: true }),
);
assert(
	!edge.disabled &&
		Number(controller.snapshot.draftCount) === 7 &&
		!reset.disabled,
	'七个阅读与退出字段必须共享一个 reading draft，并按始终显示状态联动边缘范围',
);
const saved = controller.saveAll();
assert(
	saved.kind === 'saved' &&
	saved.count === 7 &&
		updateCount === 1 &&
		!preferences.historyButtonsAlwaysVisible &&
		preferences.historyEdgeTriggerPercent === 7 &&
		preferences.historySortMode === 'first-viewed' &&
		!preferences.openTopicsAtFirstPost &&
		!preferences.readerQueueAlwaysVisibleWhenEmpty &&
		preferences.doubleEscapeToCloseReader &&
		preferences.confirmNativeComposerClose &&
		controller.snapshot.draftCount === 0,
	'阅读设置保存必须合并为一次 preference revision',
);

preferences = Object.freeze({
	...preferences,
	historyEdgeTriggerPercent: 3,
	historySortMode: 'recent-viewed',
	openTopicsAtFirstPost: true,
});
preferenceChanges.emit(preferences);
assert(
	edge.value === '3' &&
		[...sort.querySelectorAll('option')].find((option) =>
			option.hasAttribute('selected'),
		)?.getAttribute('value') ===
			'recent-viewed' &&
		openFirst.checked &&
		controller.snapshot.draftCount === 0,
	'没有本地草稿时外部偏好变更必须原地更新同一表单',
);

edge.value = '9';
edge.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
preferences = Object.freeze({
	...preferences,
	historySortMode: 'first-viewed',
});
preferenceChanges.emit(preferences);
assert(
	edge.value === '9' &&
		[...sort.querySelectorAll('option')].find((option) =>
			option.hasAttribute('selected'),
		)?.getAttribute('value') ===
			'first-viewed' &&
		Number(controller.snapshot.draftCount) === 1,
	'外部变更必须只 rebase 未编辑字段，不能覆盖本地脏字段',
);
controller.discardAll();
assert(
	String(edge.value) === '3' &&
		controller.snapshot.draftCount === 0,
	'放弃必须从当前偏好快照恢复阅读草稿',
);

edge.value = '99';
edge.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
const invalid = controller.saveAll();
assert(
	invalid.kind === 'invalid' &&
		invalid.issues.reading?.[0]?.includes('0–15%') &&
		Number(updateCount) === 1,
	'越界历史热区必须在统一保存前拒绝，不能静默截断持久化',
);
reset.click();
const resetSave = controller.saveAll();
assert(
	resetSave.kind === 'saved' &&
		Number(updateCount) === 2 &&
		preferences.historyButtonsAlwaysVisible &&
		preferences.historyEdgeTriggerPercent === 15 &&
	preferences.historySortMode === 'recent-viewed' &&
		preferences.openTopicsAtFirstPost &&
		preferences.readerQueueAlwaysVisibleWhenEmpty &&
		!preferences.doubleEscapeToCloseReader &&
		!preferences.confirmNativeComposerClose,
	'恢复默认必须更新同一草稿并由统一保存写入',
);

form.destroy();
controller.destroy();
assert(
	host.childElementCount === 0 &&
		preferenceChanges.size === 0,
	'阅读设置销毁必须注销 draft、订阅和自有 DOM',
);
