import { LifecycleScope } from '../kernel/lifecycle.js';
import type { Signal } from '../kernel/signal.js';
import type { ReaderPreferences } from '../state/reader-preferences-schema.js';
import { ReaderObjectSettingsDraft } from './reader-object-settings-draft.js';
import type {
	ReaderSettingsController,
	ReaderSettingsDraftAdapter,
} from './reader-settings-controller.js';
import {
	settingsElement as element,
	settingsFooter,
	settingsOption,
	settingsOptionRow,
	settingsSection,
	settingsSwitch,
} from './reader-settings-dom.js';

export interface ReaderReadingSettings {
	readonly historyButtonsAlwaysVisible: boolean;
	readonly historyEdgeTriggerPercent: number;
	readonly historySortMode: 'first-viewed' | 'recent-viewed';
	readonly openTopicsAtFirstPost: boolean;
	readonly readerQueueAlwaysVisibleWhenEmpty: boolean;
	readonly doubleEscapeToCloseReader: boolean;
	readonly confirmNativeComposerClose: boolean;
}

export interface ReaderReadingSettingsPreferencesAdapter<
	TPreferences extends object,
> {
	read(preferences: Readonly<TPreferences>): ReaderReadingSettings;
	createPatch(settings: ReaderReadingSettings): Partial<TPreferences>;
}

export const DEFAULT_READER_READING_SETTINGS =
	Object.freeze<ReaderReadingSettings>({
		historyButtonsAlwaysVisible: true,
		historyEdgeTriggerPercent: 15,
		historySortMode: 'recent-viewed',
		openTopicsAtFirstPost: true,
		readerQueueAlwaysVisibleWhenEmpty: true,
		doubleEscapeToCloseReader: false,
		confirmNativeComposerClose: false,
	});

export const readerPreferencesReadingSettingsAdapter = Object.freeze<
	ReaderReadingSettingsPreferencesAdapter<ReaderPreferences>
>({
	read: (preferences) => Object.freeze({
		historyButtonsAlwaysVisible:
			preferences.historyButtonsAlwaysVisible,
		historyEdgeTriggerPercent:
			preferences.historyEdgeTriggerPercent,
		historySortMode: preferences.historySortMode,
		openTopicsAtFirstPost: preferences.openTopicsAtFirstPost,
		readerQueueAlwaysVisibleWhenEmpty:
			preferences.readerQueueAlwaysVisibleWhenEmpty,
		doubleEscapeToCloseReader:
			preferences.doubleEscapeToCloseReader,
		confirmNativeComposerClose:
			preferences.confirmNativeComposerClose,
	}),
	createPatch: (settings) => Object.freeze({
		historyButtonsAlwaysVisible:
			settings.historyButtonsAlwaysVisible,
		historyEdgeTriggerPercent:
			settings.historyEdgeTriggerPercent,
		historySortMode: settings.historySortMode,
		openTopicsAtFirstPost: settings.openTopicsAtFirstPost,
		readerQueueAlwaysVisibleWhenEmpty:
			settings.readerQueueAlwaysVisibleWhenEmpty,
		doubleEscapeToCloseReader:
			settings.doubleEscapeToCloseReader,
		confirmNativeComposerClose:
			settings.confirmNativeComposerClose,
	}),
});

export interface ReaderReadingSettingsFormOptions<
	TPreferences extends object,
> {
	readonly document: Document;
	readonly host: HTMLElement;
	readonly controller: ReaderSettingsController<TPreferences>;
	readonly preferences:
		ReaderReadingSettingsPreferencesAdapter<TPreferences>;
	readonly readPreferences: () => Readonly<TPreferences>;
	readonly preferenceChanges: Pick<
		Signal<Readonly<TPreferences>>,
		'subscribe'
	>;
	readonly parentScope?: LifecycleScope;
}

type SettingName = keyof ReaderReadingSettings;
const SETTING_NAMES = Object.freeze<readonly SettingName[]>([
	'historyButtonsAlwaysVisible',
	'historyEdgeTriggerPercent',
	'historySortMode',
	'openTopicsAtFirstPost',
	'readerQueueAlwaysVisibleWhenEmpty',
	'doubleEscapeToCloseReader',
	'confirmNativeComposerClose',
]);

/**
 * “阅读与导航”面板的唯一领域表单。
 *
 * 七项阅读、历史、队列与退出策略共享一个草稿和一次偏好 revision；具体运行时仍由
 * 各自唯一 owner 热更新，不能在设置表单里复制业务状态。
 */
export class ReaderReadingSettingsForm<TPreferences extends object> {
	readonly scope: LifecycleScope;
	readonly #host: HTMLElement;
	readonly #controller: ReaderSettingsController<TPreferences>;
	readonly #preferences:
		ReaderReadingSettingsPreferencesAdapter<TPreferences>;
	readonly #draft: ReaderObjectSettingsDraft<
		ReaderReadingSettings,
		SettingName
	>;
	readonly #alwaysVisible: HTMLInputElement;
	readonly #edge: HTMLInputElement;
	readonly #edgeValue: HTMLOutputElement;
	readonly #sort: HTMLSelectElement;
	readonly #sortOptions: readonly HTMLOptionElement[];
	readonly #openFirst: HTMLInputElement;
	readonly #queueEmpty: HTMLInputElement;
	readonly #doubleEscape: HTMLInputElement;
	readonly #confirmComposer: HTMLInputElement;
	readonly #status: HTMLElement;
	readonly #reset: HTMLButtonElement;

	constructor(options: ReaderReadingSettingsFormOptions<TPreferences>) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#host = options.host;
		this.#controller = options.controller;
		this.#preferences = options.preferences;
		this.#draft = new ReaderObjectSettingsDraft(
			SETTING_NAMES,
			this.#preferences.read(options.readPreferences()),
		);
		const document = options.document;
		const groups = element(
			document,
			'div',
			'ldp-settings-category-groups',
		);
		const queue = settingsSection(
			document,
			'阅读队列入口',
			'设置队列为空时是否仍显示入口。',
			true,
		);
		const queueEmpty = settingsSwitch(
			document,
			'队列为空时仍显示入口',
			'ldp-reader-queue-always-visible-empty',
		);
		this.#queueEmpty = queueEmpty.input;
		const queueEmptyRow = settingsOptionRow(
			document,
			'队列为空时仍显示入口',
			'阅读队列没有帖子时仍显示入口；也可在队列图标右上角将其关闭。',
			queueEmpty.root,
		);
		queueEmptyRow.dataset.settingHelp =
			'阅读队列没有帖子时仍显示入口；也可在队列图标右上角将其关闭。';
		queue.append(queueEmptyRow);
		const history = settingsSection(
			document,
			'历史前进与后退',
			'设置前进、后退按钮的显示方式和浏览历史排序。',
			true,
		);
		const alwaysVisible = settingsSwitch(
			document,
			'始终显示前进和后退按钮',
			'ldp-history-buttons-always-visible-setting',
		);
		this.#alwaysVisible = alwaysVisible.input;
		const alwaysVisibleRow = settingsOptionRow(
			document,
			'始终显示前进和后退按钮',
			'历史中有可前进或后退的帖子时一直显示按钮；开启后不再使用边缘唤出范围。',
			alwaysVisible.root,
		);
		alwaysVisibleRow.dataset.settingHelp =
			'开启后，可用的历史前进和后退按钮会一直显示，并禁用“边缘唤出按钮范围”滑块；关闭后，按钮仅在鼠标进入对应边缘或键盘聚焦时显示。修改后立即保存。';
		history.append(alwaysVisibleRow);
		this.#edge = element(
			document,
			'input',
			'ldp-history-edge-trigger-range',
		);
		this.#edge.type = 'range';
		this.#edge.min = '0';
		this.#edge.max = '15';
		this.#edge.step = '1';
		this.#edge.setAttribute('aria-label', '历史按钮边缘唤出范围');
		this.#edgeValue = element(
			document,
			'output',
			'ldp-history-edge-trigger-value',
		);
		const edgeControl = element(
			document,
			'span',
			'ldp-history-edge-trigger-control',
		);
		edgeControl.append(this.#edge, this.#edgeValue);
		const edgeRow = settingsOptionRow(
			document,
			'边缘唤出按钮范围',
			'鼠标进入阅读器左右边缘后显示对应按钮；0% 为关闭，左右两侧各自最大 15%。',
			edgeControl,
			'ldp-history-edge-trigger-row',
		);
		edgeRow.dataset.settingHelp =
			'设置阅读器左右两侧用于唤出历史前进和后退按钮的范围，各占阅读器宽度的 0%–15%；范围透明且不会遮挡正文操作，0% 表示关闭鼠标唤出。修改后立即保存。';
		history.append(edgeRow);
		this.#sort = element(
			document,
			'select',
			'ldp-reader-select ldp-history-sort-mode',
		);
		this.#sort.setAttribute('aria-label', '历史排序方式');
		this.#sortOptions = Object.freeze([
			settingsOption(
				document,
				'recent-viewed',
				'最近打开优先（默认）',
			),
			settingsOption(
				document,
				'first-viewed',
				'首次打开顺序（固定）',
			),
		]);
		this.#sort.append(...this.#sortOptions);
		const sortRow = settingsOptionRow(
			document,
			'历史列表排序',
			'可以按最近打开时间排序，也可以固定为第一次打开的先后顺序。',
			this.#sort,
		);
		sortRow.dataset.settingHelp =
			'“最近打开优先”按每次打开的最新时间倒序排列，重开旧帖后它会回到列表顶部；“首次打开顺序”按每条记录第一次进入历史的时间排列，重开不会改变位置。旧记录无法还原更早的首次打开时间，会从当前保存时间开始计算。修改后立即保存。';
		history.append(sortRow);

		const opening = settingsSection(
			document,
			'帖子打开位置',
			'设置普通帖子链接默认从主楼还是链接指定楼层开始。',
			true,
		);
		const openFirst = settingsSwitch(
			document,
			'普通帖子从第 1 楼打开',
			'ldp-open-topics-first-post',
		);
		this.#openFirst = openFirst.input;
		const openFirstRow = settingsOptionRow(
			document,
			'普通帖子从第 1 楼打开',
			'普通帖子链接默认从主楼开始；消息、历史和收藏仍打开各自指定的楼层。',
			openFirst.root,
		);
		openFirstRow.dataset.settingHelp =
			'开启后，普通帖子链接会从 #1 主楼开始；消息、历史和收藏面板中的链接仍优先打开各自目标楼层。关闭后，所有链接都会尊重其中指定的楼层号。修改后立即保存。';
		opening.append(openFirstRow);
		const exit = settingsSection(
			document,
			'关闭窗口',
			'设置阅读器和 LINUX DO 原生回复窗口是否需要连续操作两次才能关闭。',
			true,
		);
		const doubleEscape = settingsSwitch(
			document,
			'按两次 Esc 关闭阅读器',
			'ldp-double-escape-close-reader',
		);
		this.#doubleEscape = doubleEscape.input;
		const doubleEscapeRow = settingsOptionRow(
			document,
			'按两次 Esc 关闭阅读器',
			'开启后可防止误触；默认关闭，按一次 Esc 即可关闭阅读器。',
			doubleEscape.root,
		);
		doubleEscapeRow.dataset.settingHelp =
			'开启后，需要在 1.5 秒内连续按两次 Esc 才会关闭阅读器；关闭后，按一次 Esc 即可关闭。修改后立即保存。';
		exit.append(doubleEscapeRow);
		const confirmComposer = settingsSwitch(
			document,
			'关闭原生回复窗口前再次确认',
			'ldp-confirm-native-composer-close',
		);
		this.#confirmComposer = confirmComposer.input;
		const confirmComposerRow = settingsOptionRow(
			document,
			'关闭原生回复窗口前再次确认',
			'默认关闭，按一次 Esc、关闭或舍弃即可关闭原生回复窗口。',
			confirmComposer.root,
		);
		confirmComposerRow.dataset.settingHelp =
			'开启后，在阅读器内按 Esc、关闭或舍弃 LINUX DO 原生回复窗口时，需要在 1.5 秒内重复同一操作；关闭后，一次操作即可关闭。修改后立即保存。';
		exit.append(confirmComposerRow);
		groups.append(queue, history, opening, exit);

		const footer = settingsFooter(document, '恢复默认');
		this.#status = footer.status;
		this.#reset = footer.reset;
		this.#host.replaceChildren(groups, footer.root);
		this.#listen();
		this.scope.listen(this.#reset, 'click', () => {
			this.#draft.setValues(DEFAULT_READER_READING_SETTINGS);
			this.#afterEdit();
		});
		const adapter: ReaderSettingsDraftAdapter<TPreferences> = {
			panelId: 'reading',
			changeCount: () => this.#draft.changeCount(),
			validate: () => this.#validate(),
			createPatch: () => this.#preferences.createPatch(
				this.#normalized(),
			),
			acceptPersisted: (preferences) => this.#accept(preferences),
			discard: (preferences) => this.#accept(preferences),
		};
		this.scope.add(this.#controller.registerDraft(adapter));
		options.preferenceChanges.subscribe((preferences) => {
			if (!this.#draft.rebase(this.#preferences.read(preferences))) {
				return;
			}
			this.#sync();
			this.#controller.refresh();
		}, this.scope);
		this.scope.add(() => this.#host.replaceChildren());
		this.#sync();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#listen(): void {
		this.scope.listen(this.#alwaysVisible, 'change', () => {
			this.#draft.set(
				'historyButtonsAlwaysVisible',
				this.#alwaysVisible.checked,
			);
			this.#afterEdit();
		});
		this.scope.listen(this.#edge, 'input', () => {
			this.#draft.set(
				'historyEdgeTriggerPercent',
				Number(this.#edge.value),
			);
			this.#afterEdit();
		});
		this.scope.listen(this.#sort, 'change', () => {
			const selected = (
				this.#sortOptions.find((option) => option.selected) ??
				this.#sortOptions.find((option) =>
					option.hasAttribute('selected'))
			)?.getAttribute('value');
			this.#draft.set(
				'historySortMode',
				selected === 'first-viewed'
					? 'first-viewed'
					: 'recent-viewed',
			);
			this.#afterEdit();
		});
		this.scope.listen(this.#openFirst, 'change', () => {
			this.#draft.set(
				'openTopicsAtFirstPost',
				this.#openFirst.checked,
			);
			this.#afterEdit();
		});
		for (const [name, input] of [
			['readerQueueAlwaysVisibleWhenEmpty', this.#queueEmpty],
			['doubleEscapeToCloseReader', this.#doubleEscape],
			['confirmNativeComposerClose', this.#confirmComposer],
		] as const) {
			this.scope.listen(input, 'change', () => {
				this.#draft.set(name, input.checked);
				this.#afterEdit();
			});
		}
	}

	#afterEdit(): void {
		this.#sync();
		this.#controller.refresh();
	}

	#normalized(): ReaderReadingSettings {
		const value = this.#draft.read();
		return Object.freeze({
			...value,
			historyEdgeTriggerPercent: Math.min(
				15,
				Math.max(0, Math.round(value.historyEdgeTriggerPercent)),
			),
		});
	}

	#validate(): readonly string[] {
		const edge = this.#draft.read().historyEdgeTriggerPercent;
		return Number.isFinite(edge) && edge >= 0 && edge <= 15
			? Object.freeze([])
			: Object.freeze(['历史按钮边缘唤出范围必须是 0–15%']);
	}

	#accept(preferences: Readonly<TPreferences>): void {
		this.#draft.accept(this.#preferences.read(preferences));
		this.#sync();
	}

	#sync(): void {
		const value = this.#draft.read();
		this.#alwaysVisible.checked = value.historyButtonsAlwaysVisible;
		this.#edge.value = Number.isFinite(value.historyEdgeTriggerPercent)
			? String(value.historyEdgeTriggerPercent)
			: '';
		this.#edge.disabled = value.historyButtonsAlwaysVisible;
		this.#edgeValue.value = `${this.#edge.value || '—'}%`;
		this.#edgeValue.textContent = this.#edgeValue.value;
		for (const option of this.#sortOptions) {
			option.selected = false;
			option.removeAttribute('selected');
		}
		const selectedSort = this.#sortOptions.find((option) =>
			option.getAttribute('value') === value.historySortMode,
		);
		if (selectedSort) {
			selectedSort.selected = true;
			selectedSort.setAttribute('selected', '');
		}
		this.#openFirst.checked = value.openTopicsAtFirstPost;
		this.#queueEmpty.checked = value.readerQueueAlwaysVisibleWhenEmpty;
		this.#doubleEscape.checked = value.doubleEscapeToCloseReader;
		this.#confirmComposer.checked = value.confirmNativeComposerClose;
		const count = this.#draft.changeCount();
		this.#status.textContent = count
			? `有 ${count} 项未保存`
			: '已与当前设置同步';
		this.#reset.disabled = SETTING_NAMES.every((name) =>
			Object.is(
				value[name],
				DEFAULT_READER_READING_SETTINGS[name],
			),
		);
	}
}
