import { LifecycleScope } from '../kernel/lifecycle.js';
import type { Signal } from '../kernel/signal.js';
import {
	applyBoostCopyRule,
	DEFAULT_BOOST_COPY_SETTINGS,
	normalizeBoostCopySettings,
	type BoostCopyPreferencesAdapter,
	type BoostCopySettings,
} from '../post/boost-copy-rule.js';
import {
	DEFAULT_TOPIC_ACTION_RAIL_PREFERENCES,
	type ReaderTopicActionRailPreferences,
	type ReaderTopicActionRailPreferencesAdapter,
} from '../post/reader-topic-action-rail.js';
import type {
	ReaderSettingsController,
	ReaderSettingsDraftAdapter,
} from './reader-settings-controller.js';
import {
	settingsButton,
	settingsElement as element,
	settingsFooter,
	settingsOption,
	settingsOptionRow,
	settingsSection,
	settingsSwitch,
} from './reader-settings-dom.js';
import { ReaderObjectSettingsDraft } from './reader-object-settings-draft.js';
import {
	DEFAULT_READER_REPLY_TREE_PREFERENCES,
	normalizeReaderReplyTreePreferences,
	type ReaderReplyTreePreferences,
	type ReaderReplyTreePreferencesAdapter,
	type ReaderReplyTreePreferencesPreviewPort,
	type ReaderReplyTreeSettingName,
} from '../topic/reader-reply-tree-preferences.js';

export interface ReaderInteractionSettingsFormOptions<
	TPreferences extends object,
> {
	readonly document: Document;
	readonly host: HTMLElement;
	readonly controller: ReaderSettingsController<TPreferences>;
	readonly boostCopy: BoostCopyPreferencesAdapter<TPreferences>;
	readonly topicActionRail:
		ReaderTopicActionRailPreferencesAdapter<TPreferences>;
	readonly replyTree:
		ReaderReplyTreePreferencesAdapter<TPreferences>;
	readonly replyTreePreview?: ReaderReplyTreePreferencesPreviewPort;
	readonly boostsAvailable?: boolean;
	readonly readPreferences: () => Readonly<TPreferences>;
	readonly preferenceChanges: Pick<
		Signal<Readonly<TPreferences>>,
		'subscribe'
	>;
	readonly parentScope?: LifecycleScope;
}

type BoostCopySettingName = keyof BoostCopySettings;
type TopicActionRailSettingName = keyof ReaderTopicActionRailPreferences;

const BOOST_COPY_SETTING_NAMES =
	Object.freeze<readonly BoostCopySettingName[]>([
		'mode',
		'prefix',
		'counterMarker',
		'counterStep',
		'fixedSuffix',
	]);

/**
 * “帖子与回复”面板的唯一领域表单。
 *
 * 主帖操作列、回复树与 Boost 复制共享一个草稿和一次持久化事务，不能再为 interaction
 * panel 建第二个 replaceChildren/即时写偏好路径。
 */
export class ReaderInteractionSettingsForm<TPreferences extends object> {
	readonly scope: LifecycleScope;
	readonly #host: HTMLElement;
	readonly #controller: ReaderSettingsController<TPreferences>;
	readonly #boostCopy: BoostCopyPreferencesAdapter<TPreferences>;
	readonly #topicActionRail:
		ReaderTopicActionRailPreferencesAdapter<TPreferences>;
	readonly #replyTree:
		ReaderReplyTreePreferencesAdapter<TPreferences>;
	readonly #replyTreePreview:
		ReaderReplyTreePreferencesPreviewPort | undefined;
	readonly #boostDraft: ReaderObjectSettingsDraft<
		BoostCopySettings,
		BoostCopySettingName
	>;
	readonly #railDraft: ReaderObjectSettingsDraft<
		ReaderTopicActionRailPreferences,
		TopicActionRailSettingName
	>;
	readonly #treeDraft: ReaderObjectSettingsDraft<
		ReaderReplyTreePreferences,
		ReaderReplyTreeSettingName
	>;
	readonly #railVisible: HTMLInputElement;
	readonly #railFixed: HTMLInputElement;
	readonly #railPositionReset: HTMLButtonElement;
	readonly #expandNested: HTMLInputElement;
	readonly #expandLeaf: HTMLInputElement;
	readonly #aggregateDescendants: HTMLInputElement;
	readonly #treeDepth: HTMLSelectElement;
	readonly #hideNestedFloors: HTMLInputElement;
	readonly #nestedWarning: HTMLElement;
	readonly #mode: HTMLSelectElement;
	readonly #prefix: HTMLInputElement;
	readonly #counterMarker: HTMLInputElement;
	readonly #counterStep: HTMLInputElement;
	readonly #fixedSuffix: HTMLInputElement;
	readonly #counterRows: HTMLElement[] = [];
	readonly #textRows: HTMLElement[] = [];
	readonly #preview: HTMLElement;
	readonly #status: HTMLElement;
	readonly #reset: HTMLButtonElement;

	constructor(options: ReaderInteractionSettingsFormOptions<TPreferences>) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#host = options.host;
		this.#controller = options.controller;
		this.#boostCopy = options.boostCopy;
		this.#topicActionRail = options.topicActionRail;
		this.#replyTree = options.replyTree;
		this.#replyTreePreview = options.replyTreePreview;
		this.#boostDraft = new ReaderObjectSettingsDraft(
			BOOST_COPY_SETTING_NAMES,
			this.#boostCopy.read(options.readPreferences()),
		);
		this.#railDraft = new ReaderObjectSettingsDraft(
			['visible', 'fixed', 'mode', 'position'],
			this.#topicActionRail.read(options.readPreferences()),
		);
		this.#treeDraft = new ReaderObjectSettingsDraft(
			[
				'expandNestedRepliesByDefault',
				'expandLeafNestedReplies',
				'aggregateDescendantReplies',
				'inlineReplyTreeMaxDepth',
				'hideNestedReplyFloors',
			],
			this.#replyTree.read(options.readPreferences()),
		);

		const document = options.document;
		const groups = element(
			document,
			'div',
			'ldp-settings-category-groups',
		);
		const railSection = settingsSection(
			document,
			'主帖操作列',
			'全收纳与常显状态会保留；全部弹出是临时状态，点击外部或重新载入后退回常显。',
			true,
		);

		const visibleSwitch = settingsSwitch(
			document,
			'显示主帖操作列',
			'ldp-topic-action-rail-visible-setting',
		);
		this.#railVisible = visibleSwitch.input;
		const railVisibleRow = settingsOptionRow(
			document,
			'显示主帖操作列',
			'显示回到顶部和收纳按钮；全展开时点击外部或重新载入会退回常显。',
			visibleSwitch.root,
		);
		railVisibleRow.dataset.settingHelp =
			'显示回到顶部和收纳按钮；全展开时点击外部或重新载入会退回常显。';
		railSection.append(railVisibleRow);

		const treeSection = settingsSection(
			document,
			'二级回复显示位置',
			'设置二级回复在父回复下、楼层列表中和“完整讨论”视图中的显示方式。',
			true,
		);
		const expandNestedSwitch = settingsSwitch(
			document,
			'在父回复下展开二级回复',
			'ldp-expand-nested-replies-default',
		);
		this.#expandNested = expandNestedSwitch.input;
		const expandNestedRow = settingsOptionRow(
			document,
			'在父回复下展开二级回复',
			'默认在父楼层下直接显示它收到的回复；关闭时同时关闭“完整讨论”视图。',
			expandNestedSwitch.root,
		);
		expandNestedRow.dataset.settingHelp =
			'开启后，在每条父回复下默认展开直属回复；关闭时会同时关闭深层回复阅读。修改后立即保存并应用到当前帖子。';
		treeSection.append(expandNestedRow);
		const expandLeafSwitch = settingsSwitch(
			document,
			'在正式楼层位置保留回复',
			'ldp-expand-leaf-nested-replies',
		);
		this.#expandLeaf = expandLeafSwitch.input;
		const expandLeafRow = settingsOptionRow(
			document,
			'在楼层列表中展开二级回复',
			'二级回复出现在楼层列表时默认显示完整正文；关闭时必须保留上面的父回复展开方式。',
			expandLeafSwitch.root,
		);
		expandLeafRow.dataset.settingHelp =
			'开启后，二级回复在楼层列表中的对应位置默认完整展开；可与父回复下的二级回复同时显示，但至少要保留一种显示位置。修改后立即保存并应用到当前帖子。';
		expandLeafRow.hidden = true;
		treeSection.append(expandLeafRow);
		const aggregateSwitch = settingsSwitch(
			document,
			'启用深层回复阅读',
			'ldp-aggregate-descendant-replies',
		);
		this.#aggregateDescendants = aggregateSwitch.input;
		const aggregateRow = settingsOptionRow(
			document,
			'启用深层回复阅读',
			'可在主信息流嵌套阅读，并用无限树状完整讨论继续更深回复。',
			aggregateSwitch.root,
		);
		aggregateRow.dataset.settingHelp =
			'建立在“在父回复下展开二级回复”之上；开启后可选择直接进入完整讨论，或先在主信息流树状嵌套。修改后立即保存并应用到当前帖子。';
		treeSection.append(aggregateRow);
		this.#treeDepth = element(
			document,
			'select',
			'ldp-reader-select ldp-inline-reply-tree-depth',
		);
		this.#treeDepth.setAttribute('aria-label', '深层回复展示方式');
		this.#treeDepth.append(
			settingsOption(document, '1', '完整讨论窗口'),
			settingsOption(document, '2', '树状嵌套 · 2 层'),
			settingsOption(document, '3', '树状嵌套 · 3 层'),
			settingsOption(document, '4', '树状嵌套 · 4 层'),
			settingsOption(document, '5', '树状嵌套 · 5 层'),
		);
		const treeDepthRow = settingsOptionRow(
			document,
			'深层回复展示方式',
			'主信息流超出所选深度后，用无限树状完整讨论继续阅读。',
			this.#treeDepth,
			'ldp-inline-reply-tree-row',
		);
		treeDepthRow.dataset.settingHelp =
			'修改后立即重建当前预加载范围内的回复树；主信息流按所选深度像 Reddit 一样继续缩进，超出深度后可进入完整讨论。';
		treeSection.append(treeDepthRow);
		const hideFloorsSwitch = settingsSwitch(
			document,
			'从楼层列表隐藏树外回复',
			'ldp-hide-nested-reply-floors',
		);
		this.#hideNestedFloors = hideFloorsSwitch.input;
		const hideNestedFloorsRow = settingsOptionRow(
			document,
			'从楼层列表隐藏二级回复',
			'二级回复固定收纳到对应父楼层。',
			hideFloorsSwitch.root,
		);
		hideNestedFloorsRow.dataset.settingHelp =
			'未启用“完整讨论”时，从楼层列表隐藏全部二级回复；启用后先保留未读二级回复，读过后再隐藏。时间轴、跳转和已读记录不受影响；跳转时会临时显示或打开对应讨论。修改后立即保存并应用到当前帖子。';
		hideNestedFloorsRow.hidden = true;
		treeSection.append(hideNestedFloorsRow);
		this.#nestedWarning = element(
			document,
			'p',
			'ldp-nested-display-warning',
		);
		this.#nestedWarning.textContent =
			'同一楼层只保留一个 canonical DOM；树内回复不会再复制成独立楼层。';
		this.#nestedWarning.role = 'status';
		this.#nestedWarning.setAttribute('aria-live', 'polite');
		treeSection.append(this.#nestedWarning);
		const fixedSwitch = settingsSwitch(
			document,
			'锁定操作列位置',
			'ldp-topic-action-rail-fixed-setting',
		);
		this.#railFixed = fixedSwitch.input;
		const railFixedRow = settingsOptionRow(
			document,
			'锁定操作列位置',
			'开启后不能拖动操作列；关闭后可长按收纳按钮并拖到其他位置。',
			fixedSwitch.root,
		);
		railFixedRow.dataset.settingHelp =
			'开启后不能拖动操作列；关闭后可长按收纳按钮并拖到其他位置。';
		railSection.append(railFixedRow);
		this.#railPositionReset = settingsButton(
			document,
			'ldp-config-action ldp-topic-action-rail-reset',
			'',
			'rotate-ccw',
			'恢复默认',
		);
		railSection.append(settingsOptionRow(
			document,
			'操作列默认位置',
			'恢复到正文左侧留白区域。',
			this.#railPositionReset,
			'ldp-topic-action-rail-reset-row',
		));

		const section = settingsSection(
			document,
			'复制 Boost 文本',
			'复制结果 = 前置文字 + Boost 原文 + 末尾内容；最终最多 16 字。',
		);

		this.#mode = element(
			document,
			'select',
			'ldp-reader-select ldp-boost-copy-mode ldp-boost-rule-control',
		);
		this.#mode.setAttribute('aria-label', 'Boost 末尾内容方式');
		this.#mode.append(
			settingsOption(document, 'counter', '递增数字'),
			settingsOption(document, 'text', '固定文字'),
		);
		section.append(this.#row(
			document,
			'末尾内容方式',
			this.#mode,
			'',
			'选择复制 Boost 时如何生成末尾内容：“递增数字”每次按设定步长增加，“固定文字”每次追加同一段文字。修改后立即保存。',
		));

		this.#prefix = this.#textInput(
			document,
			'ldp-boost-copy-prefix',
			'Boost 前置文字',
			'可选，例如：赞同：',
		);
		section.append(this.#row(
			document,
			'前置文字',
			this.#prefix,
			'',
			'填写复制结果开头的前置文字，例如“赞同：”。留空就直接从原 Boost 内容开始，最多 16 个字。修改后立即保存。',
		));

		this.#counterMarker = this.#textInput(
			document,
			'ldp-boost-copy-counter-marker',
			'Boost 数字前缀',
			'默认 +，也可填文字',
		);
		const markerRow = this.#row(
			document,
			'数字前缀',
			this.#counterMarker,
			'ldp-boost-counter-row',
			'使用递增数字时，填写数字前缀，例如“+”会得到“原 Boost +1”；留空时数字会直接接在原文后面。修改后立即保存。',
		);
		this.#counterRows.push(markerRow);
		section.append(markerRow);

		this.#counterStep = element(
			document,
			'input',
			'ldp-boost-copy-counter-step ldp-boost-rule-control',
		);
		this.#counterStep.type = 'number';
		this.#counterStep.min = '1';
		this.#counterStep.max = '99';
		this.#counterStep.step = '1';
		this.#counterStep.inputMode = 'numeric';
		this.#counterStep.setAttribute('aria-label', 'Boost 递增步长');
		const stepRow = this.#row(
			document,
			'递增步长',
			this.#counterStep,
			'ldp-boost-counter-row',
			'使用递增数字时，每复制一次增加多少。设为 1 会依次得到 1、2、3；设为 5 会得到 5、10、15。修改后立即保存。',
		);
		this.#counterRows.push(stepRow);
		section.append(stepRow);

		this.#fixedSuffix = this.#textInput(
			document,
			'ldp-boost-copy-fixed-suffix',
			'Boost 固定末尾文字',
			'例如：俺也一样',
		);
		const suffixRow = this.#row(
			document,
			'固定末尾文字',
			this.#fixedSuffix,
			'ldp-boost-text-row',
			'使用固定文字时，每次复制都会把这里的内容追加到原 Boost 后面，例如“俺也一样”。最多 16 个字。修改后立即保存。',
		);
		this.#textRows.push(suffixRow);
		section.append(suffixRow);

		const previewRow = element(
			document,
			'div',
			'ldp-setting-row ldp-boost-rule-row ldp-boost-copy-preview-row',
		);
		const previewLabel = element(document, 'span', 'ldp-setting-label');
		previewLabel.textContent = '结果预览';
		const previewValue = element(
			document,
			'span',
			'ldp-boost-rule-preview',
		);
		this.#preview = element(document, 'code', 'ldp-boost-copy-preview');
		this.#preview.setAttribute('aria-live', 'polite');
		const previewLimit = element(document, 'small');
		previewLimit.textContent = '最多 16 字';
		previewValue.append(this.#preview, previewLimit);
		previewRow.dataset.settingHelp =
			'展示当前规则实际会复制出的结果；使用递增数字时会同时展示连续两次复制，方便确认步长。';
		previewRow.append(previewLabel, previewValue);
		section.append(previewRow);
		const boostSectionHost = element(
			document,
			'div',
			'ldp-boost-settings-availability',
		);
		boostSectionHost.hidden = options.boostsAvailable === false;
		boostSectionHost.append(section);
		groups.append(railSection, treeSection, boostSectionHost);

		const footer = settingsFooter(document, '恢复默认');
		this.#status = footer.status;
		this.#reset = footer.reset;
		this.#host.replaceChildren(groups, footer.root);

		this.#listen();
		this.scope.listen(this.#reset, 'click', () => {
			this.#boostDraft.setValues(DEFAULT_BOOST_COPY_SETTINGS);
			this.#railDraft.setValues(
				DEFAULT_TOPIC_ACTION_RAIL_PREFERENCES,
			);
			this.#treeDraft.setValues(
				DEFAULT_READER_REPLY_TREE_PREFERENCES,
			);
			this.#afterTreeEdit();
		});
		this.scope.listen(this.#railPositionReset, 'click', () => {
			this.#railDraft.set(
				'position',
				DEFAULT_TOPIC_ACTION_RAIL_PREFERENCES.position,
			);
			this.#afterEdit();
		});
		const adapter: ReaderSettingsDraftAdapter<TPreferences> = {
			panelId: 'interaction',
			changeCount: () =>
				this.#boostDraft.changeCount() +
				this.#railDraft.changeCount() +
				this.#treeDraft.changeCount(),
			validate: () => this.#validate(),
			createPatch: () => ({
				...this.#boostCopy.createPatch(
					normalizeBoostCopySettings(this.#boostDraft.read()),
				),
				...this.#topicActionRail.createPatch(this.#railDraft.read()),
				...this.#replyTree.createPatch(
					normalizeReaderReplyTreePreferences(
						this.#treeDraft.read(),
					),
				),
			}),
			acceptPersisted: (preferences) => this.#accept(preferences),
			discard: (preferences) => this.#accept(preferences),
		};
		this.scope.add(this.#controller.registerDraft(adapter));
		options.preferenceChanges.subscribe((preferences) => {
			const boostChanged = this.#boostDraft.rebase(
				this.#boostCopy.read(preferences),
			);
			const railChanged = this.#railDraft.rebase(
				this.#topicActionRail.read(preferences),
			);
			const treeChanged = this.#treeDraft.rebase(
				this.#replyTree.read(preferences),
			);
			if (!boostChanged && !railChanged && !treeChanged) return;
			this.#sync();
			if (treeChanged) this.#previewTree();
			this.#controller.refresh();
		}, this.scope);
		this.scope.add(() => this.#host.replaceChildren());
		this.#sync();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#textInput(
		document: Document,
		className: string,
		label: string,
		placeholder: string,
	): HTMLInputElement {
		const input = element(
			document,
			'input',
			`${className} ldp-boost-rule-control`,
		);
		input.type = 'text';
		input.maxLength = 16;
		input.autocomplete = 'off';
		input.placeholder = placeholder;
		input.setAttribute('aria-label', label);
		return input;
	}

	#row(
		document: Document,
		labelText: string,
		control: HTMLElement,
		extraClass = '',
		help = '',
	): HTMLElement {
		const row = element(
			document,
			'label',
			`ldp-setting-row ldp-boost-rule-row ${extraClass}`.trim(),
		);
		const label = element(document, 'span', 'ldp-setting-label');
		label.textContent = labelText;
		if (help) row.dataset.settingHelp = help;
		row.append(label, control);
		return row;
	}

	#listen(): void {
		this.scope.listen(this.#railVisible, 'change', () => {
			this.#railDraft.set('visible', this.#railVisible.checked);
			this.#afterEdit();
		});
		this.scope.listen(this.#railFixed, 'change', () => {
			this.#railDraft.set('fixed', this.#railFixed.checked);
			this.#afterEdit();
		});
		this.scope.listen(this.#expandNested, 'change', () => {
			this.#treeDraft.set(
				'expandNestedRepliesByDefault',
				this.#expandNested.checked,
			);
			if (!this.#expandNested.checked) {
				this.#treeDraft.set('aggregateDescendantReplies', false);
				this.#treeDraft.set('expandLeafNestedReplies', true);
			}
			this.#afterTreeEdit();
		});
		this.scope.listen(this.#expandLeaf, 'change', () => {
			this.#treeDraft.set(
				'expandLeafNestedReplies',
				this.#expandLeaf.checked,
			);
			if (
				!this.#expandLeaf.checked &&
				!this.#treeDraft.read().expandNestedRepliesByDefault
			) {
				this.#treeDraft.set('expandNestedRepliesByDefault', true);
			}
			this.#afterTreeEdit();
		});
		this.scope.listen(this.#aggregateDescendants, 'change', () => {
			this.#treeDraft.set(
				'aggregateDescendantReplies',
				this.#aggregateDescendants.checked,
			);
			if (this.#aggregateDescendants.checked) {
				this.#treeDraft.set('expandNestedRepliesByDefault', true);
			}
			this.#afterTreeEdit();
		});
		this.scope.listen(this.#treeDepth, 'change', () => {
			this.#treeDraft.set(
				'inlineReplyTreeMaxDepth',
				Number(this.#treeDepth.value),
			);
			this.#afterTreeEdit();
		});
		this.scope.listen(this.#hideNestedFloors, 'change', () => {
			this.#treeDraft.set(
				'hideNestedReplyFloors',
				this.#hideNestedFloors.checked,
			);
			this.#afterTreeEdit();
		});
		this.scope.listen(this.#mode, 'change', () => {
			this.#boostDraft.set(
				'mode',
				this.#mode.value === 'text' ? 'text' : 'counter',
			);
			this.#afterEdit();
		});
		const textFields = [
			['prefix', this.#prefix],
			['counterMarker', this.#counterMarker],
			['fixedSuffix', this.#fixedSuffix],
		] as const;
		for (const [name, input] of textFields) {
			this.scope.listen(input, 'input', () => {
				this.#boostDraft.set(name, input.value);
				this.#afterEdit();
			});
		}
		this.scope.listen(this.#counterStep, 'input', () => {
			this.#boostDraft.set('counterStep', Number(this.#counterStep.value));
			this.#afterEdit();
		});
	}

	#afterEdit(): void {
		this.#sync();
		this.#controller.refresh();
	}

	#afterTreeEdit(): void {
		this.#sync();
		this.#previewTree();
		this.#controller.refresh();
	}

	#accept(preferences: Readonly<TPreferences>): void {
		this.#boostDraft.accept(this.#boostCopy.read(preferences));
		this.#railDraft.accept(this.#topicActionRail.read(preferences));
		this.#treeDraft.accept(this.#replyTree.read(preferences));
		this.#sync();
		this.#previewTree();
	}

	#previewTree(): void {
		this.#replyTreePreview?.update(
			normalizeReaderReplyTreePreferences(this.#treeDraft.read()),
		);
	}

	#validate(): readonly string[] {
		const value = this.#boostDraft.read();
		const issues: string[] = [];
		if (
			value.mode === 'counter' &&
			/\d$/.test(String(value.counterMarker).trim())
		) {
			issues.push('Boost 数字前缀不能以数字结尾');
		}
		if (
			value.mode === 'counter' &&
			(
				!Number.isFinite(value.counterStep) ||
				value.counterStep < 1 ||
				value.counterStep > 99
			)
		) {
			issues.push('Boost 递增步长必须是 1–99');
		}
		return Object.freeze(issues);
	}

	#sync(): void {
		const value = this.#boostDraft.read();
		const rail = this.#railDraft.read();
		const tree = normalizeReaderReplyTreePreferences(
			this.#treeDraft.read(),
		);
		this.#railVisible.checked = rail.visible;
		this.#railFixed.checked = rail.fixed;
		this.#railPositionReset.disabled =
			rail.position.x ===
				DEFAULT_TOPIC_ACTION_RAIL_PREFERENCES.position.x &&
			rail.position.y ===
				DEFAULT_TOPIC_ACTION_RAIL_PREFERENCES.position.y;
		this.#expandNested.checked =
			tree.expandNestedRepliesByDefault;
		this.#expandLeaf.checked = tree.expandLeafNestedReplies;
		this.#aggregateDescendants.checked =
			tree.aggregateDescendantReplies;
		for (const option of [...this.#treeDepth.options]) {
			option.selected =
				option.value === String(tree.inlineReplyTreeMaxDepth);
		}
		this.#treeDepth.disabled =
			!tree.aggregateDescendantReplies ||
			!tree.expandNestedRepliesByDefault;
		this.#hideNestedFloors.checked = tree.hideNestedReplyFloors;
		this.#nestedWarning.hidden = !(
			tree.expandNestedRepliesByDefault &&
			tree.expandLeafNestedReplies
		);
		for (const option of [...this.#mode.options]) {
			option.selected = option.value === value.mode;
		}
		this.#prefix.value = value.prefix;
		this.#counterMarker.value = value.counterMarker;
		this.#counterStep.value = Number.isFinite(value.counterStep)
			? String(value.counterStep)
			: '';
		this.#fixedSuffix.value = value.fixedSuffix;
		const counterMode = value.mode === 'counter';
		for (const row of this.#counterRows) row.hidden = !counterMode;
		for (const row of this.#textRows) row.hidden = counterMode;
		const first = applyBoostCopyRule('原 Boost', value);
		this.#preview.textContent = counterMode
			? `${first} → ${applyBoostCopyRule(first, value)}`
			: first;
		const count =
			this.#boostDraft.changeCount() +
			this.#railDraft.changeCount() +
			this.#treeDraft.changeCount();
		this.#status.textContent = count
			? `有 ${count} 项未保存`
			: '已与当前设置同步';
		this.#reset.disabled =
			BOOST_COPY_SETTING_NAMES.every((name) =>
				Object.is(value[name], DEFAULT_BOOST_COPY_SETTINGS[name])) &&
			rail.visible === DEFAULT_TOPIC_ACTION_RAIL_PREFERENCES.visible &&
			rail.fixed === DEFAULT_TOPIC_ACTION_RAIL_PREFERENCES.fixed &&
			rail.mode === DEFAULT_TOPIC_ACTION_RAIL_PREFERENCES.mode &&
			rail.position.x ===
				DEFAULT_TOPIC_ACTION_RAIL_PREFERENCES.position.x &&
			rail.position.y ===
				DEFAULT_TOPIC_ACTION_RAIL_PREFERENCES.position.y &&
			(
				Object.keys(DEFAULT_READER_REPLY_TREE_PREFERENCES) as
					ReaderReplyTreeSettingName[]
			).every((name) => Object.is(
				tree[name],
				DEFAULT_READER_REPLY_TREE_PREFERENCES[name],
			));
	}
}
