import {
	READER_FONT_FAMILY_LABELS,
	READER_FONT_SETTINGS_DEFAULT,
	normalizeReaderFontSettings,
	readerFontFamilyCss,
	type ReaderFontRenderingMode,
	type ReaderFontSettings,
	type ReaderFontStyleController,
} from '../font/reader-font-style-controller.js';
import {
	READER_FONT_OPTION_PREVIEW,
	readerLocalFontPresentation,
} from '../font/reader-local-font-catalog.js';
import {
	readReaderFontCatalogValue,
	readerFontCatalogValue,
	type ReaderFontCatalogEntry,
	type ReaderFontCatalogPort,
} from '../font/reader-font-catalog.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import {
	READER_FONT_FAMILIES,
	READER_FONT_SCALE_LIMITS,
	READER_FONT_WEIGHTS,
	READER_HOST_FONT_SCALE_LIMITS,
	type ReaderFontFamily,
	type ReaderFontProfile,
	type ReaderFontWeight,
} from '../state/reader-preferences-schema.js';
import {
	READER_SELECT_OPEN_EVENT,
	READER_SELECT_OPTIONS_CHANGE_EVENT,
} from '../shell/reader-select-surface.js';
import type {
	ReaderSettingsController,
	ReaderSettingsDraftAdapter,
} from './reader-settings-controller.js';
import {
	settingsButton,
	settingsCopy,
	settingsElement as element,
	settingsFooter,
	settingsOption,
	settingsSection,
	settingsSwitch,
} from './reader-settings-dom.js';
import { ReaderObjectSettingsDraft } from './reader-object-settings-draft.js';

type ReaderFontOuterSettings = Omit<ReaderFontSettings, 'fontProfile'>;
type ReaderFontDraft = Readonly<
	ReaderFontOuterSettings & ReaderFontProfile
>;
type ReaderFontSettingName = keyof ReaderFontDraft;
type ReaderFontScope = 'interface' | 'post' | 'composer' | 'host';

export interface ReaderFontSettingsFormOptions<TPreferences extends object> {
	readonly document: Document;
	readonly host: HTMLElement;
	readonly controller: ReaderSettingsController<TPreferences>;
	readonly font: ReaderFontStyleController<TPreferences>;
	readonly queryLocalFonts?: () => Promise<readonly string[]>;
	readonly fontCatalog?: ReaderFontCatalogPort;
	readonly parentScope?: LifecycleScope;
}

const LOCAL_FONT_VALUE_PREFIX = 'local-font:';

function localFontValue(name: string): string {
	return `${LOCAL_FONT_VALUE_PREFIX}${name}`;
}

function readLocalFontValue(value: string | undefined): string | null {
	const normalized = String(value ?? '');
	return normalized.startsWith(LOCAL_FONT_VALUE_PREFIX)
		? normalized.slice(LOCAL_FONT_VALUE_PREFIX.length)
		: null;
}
const WEIGHT_LABELS = Object.freeze<Record<ReaderFontWeight, string>>({
	300: '细 300',
	400: '常规 400',
	500: '中等 500',
	600: '半粗 600',
});
const SCOPE_FIELDS = Object.freeze({
	interface: Object.freeze({
		label: '界面文字',
		family: 'family',
		customFamily: 'customFamily',
		weight: 'weight',
		color: 'interfaceColor',
		scale: 'interface',
	}),
	post: Object.freeze({
		label: '帖子正文',
		family: 'postFamily',
		customFamily: 'postCustomFamily',
		weight: 'postWeight',
		color: 'postColor',
		scale: 'post',
	}),
	composer: Object.freeze({
		label: '回复输入框',
		family: 'composerFamily',
		customFamily: 'composerCustomFamily',
		weight: 'composerWeight',
		color: 'composerColor',
		scale: 'composer',
	}),
	host: Object.freeze({
		label: '原站主题列表',
		family: 'hostFontFamily',
		customFamily: 'hostFontCustomFamily',
		weight: 'hostFontWeight',
		color: 'hostFontColor',
		scale: null,
	}),
} as const);
const OUTER_NAMES = Object.freeze<readonly (keyof ReaderFontOuterSettings)[]>([
	'fontRenderingEnabled',
	'fontRenderingOnHost',
	'hostFontFamily',
	'hostFontCustomFamily',
	'hostFontWeight',
	'hostFontColor',
	'hostEmbeddedTitleScale',
	'hostEmbeddedAvatarScale',
	'hostEmbeddedStatsScale',
	'hostEmbeddedLabelCardScale',
]);
const PROFILE_NAMES = Object.freeze<readonly (keyof ReaderFontProfile)[]>([
	'family',
	'customFamily',
	'weight',
	'interfaceColor',
	'interface',
	'postFamily',
	'postCustomFamily',
	'postWeight',
	'postColor',
	'post',
	'composerFamily',
	'composerCustomFamily',
	'composerWeight',
	'composerColor',
	'composer',
]);
const ALL_NAMES = Object.freeze<readonly ReaderFontSettingName[]>([
	...OUTER_NAMES,
	...PROFILE_NAMES,
]);
const HOST_SIZE_FIELDS = Object.freeze([
	Object.freeze({
		name: 'hostEmbeddedTitleScale',
		title: '主题标题',
	}),
	Object.freeze({
		name: 'hostEmbeddedAvatarScale',
		title: '头像',
	}),
	Object.freeze({
		name: 'hostEmbeddedStatsScale',
		title: '主题统计信息',
	}),
	Object.freeze({
		name: 'hostEmbeddedLabelCardScale',
		title: '标签卡片',
	}),
] as const);

function draftFromSettings(settings: ReaderFontSettings): ReaderFontDraft {
	const { fontProfile, ...outer } = settings;
	return Object.freeze({
		...outer,
		...fontProfile,
	});
}
const READER_FONT_DRAFT_DEFAULT = draftFromSettings(
	READER_FONT_SETTINGS_DEFAULT,
);

function settingsFromDraft(draft: ReaderFontDraft): ReaderFontSettings {
	const outer = Object.fromEntries(
		OUTER_NAMES.map((name) => [name, draft[name]]),
	) as unknown as ReaderFontOuterSettings;
	const fontProfile = Object.freeze(Object.fromEntries(
		PROFILE_NAMES.map((name) => [name, draft[name]]),
	) as unknown as ReaderFontProfile);
	return normalizeReaderFontSettings({ ...outer, fontProfile });
}

function appendOption(
	document: Document,
	parent: HTMLSelectElement | HTMLOptGroupElement,
	value: string,
	label: string,
): HTMLOptionElement {
	const option = settingsOption(document, value, label);
	parent.append(option);
	return option;
}

function addFontPreview(
	option: HTMLOptionElement,
	fontFamilyCss: string,
	searchText = '',
): void {
	option.dataset.readerSelectPreview = READER_FONT_OPTION_PREVIEW;
	option.dataset.readerSelectFontFamily = fontFamilyCss;
	if (searchText) option.dataset.readerSelectSearchText = searchText;
}

function selectValue(select: HTMLSelectElement, value: string): void {
	const options = [...select.options];
	for (const option of options) {
		option.selected = false;
		option.removeAttribute('selected');
	}
	const selected = options.find((option) => option.value === value);
	if (selected) {
		selected.selected = true;
		selected.setAttribute('selected', '');
	}
}

function selectedValue(select: HTMLSelectElement): string {
	return [...select.options].filter((option) => option.selected).at(-1)?.value ??
		String(select.value ?? '');
}

/**
 * 字体面板唯一草稿 owner。所有预览只提交完整 ReaderFontSettings 给 font runtime。
 */
export class ReaderFontSettingsForm<TPreferences extends object> {
	readonly scope: LifecycleScope;
	readonly #host: HTMLElement;
	readonly #controller: ReaderSettingsController<TPreferences>;
	readonly #font: ReaderFontStyleController<TPreferences>;
	readonly #queryLocalFonts:
		| (() => Promise<readonly string[]>)
		| undefined;
	readonly #fontCatalog: ReaderFontCatalogPort | null;
	readonly #draft: ReaderObjectSettingsDraft<
		ReaderFontDraft,
		ReaderFontSettingName
	>;
	readonly #inputs = new Map<ReaderFontSettingName, HTMLInputElement>();
	readonly #selects = new Map<ReaderFontSettingName, HTMLSelectElement>();
	readonly #values = new Map<ReaderFontSettingName, HTMLElement>();
	readonly #scopePanels = new Map<ReaderFontScope, HTMLElement>();
	readonly #scopeTabs = new Map<ReaderFontScope, HTMLButtonElement>();
	readonly #fontList: HTMLDataListElement;
	readonly #fontStatus: HTMLElement;
	readonly #status: HTMLElement;
	readonly #reset: HTMLButtonElement;
	#importFile: HTMLInputElement | null = null;
	#importedSelect: HTMLSelectElement | null = null;
	#removeImported: HTMLButtonElement | null = null;
	#sharedFonts: readonly ReaderFontCatalogEntry[] = Object.freeze([]);
	#activeScope: ReaderFontScope = 'interface';
	#fontQueryEpoch = 0;
	#localFontsLoaded = false;
	#localFontsLoading = false;
	#localFontCount: number | null = null;
	#syncingFont = false;
	#lastMode: ReaderFontRenderingMode;

	constructor(options: ReaderFontSettingsFormOptions<TPreferences>) {
		this.#host = options.host;
		this.#controller = options.controller;
		this.#font = options.font;
		this.#fontCatalog = options.fontCatalog ?? null;
		this.#queryLocalFonts = this.#fontCatalog?.queryLocalFonts ??
			options.queryLocalFonts;
		this.#lastMode = this.#font.snapshot.mode;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#draft = new ReaderObjectSettingsDraft(
			ALL_NAMES,
			draftFromSettings(this.#font.settings()),
		);
		const document = options.document;
		const content = element(
			document,
			'div',
			'ldp-settings-category-groups ldp-font-groups',
		);
		content.append(this.#renderRendering(document));
		content.append(this.#renderHostSizes(document));
		if (this.#fontCatalog) content.append(this.#renderFontLibrary(document));
		content.append(this.#renderScopes(document));

		this.#fontList = element(document, 'datalist');
		this.#fontList.id = 'ldp-local-fonts';
		for (const input of this.#inputs.values()) {
			if (input.dataset.fontCustom === 'true') {
				input.setAttribute('list', this.#fontList.id);
			}
		}
		content.append(this.#fontList);

		this.#fontStatus = element(
			document,
			'span',
			'ldp-font-family-source-status',
		);
		this.#fontStatus.role = 'status';
		this.#fontStatus.setAttribute('aria-live', 'polite');
		this.#fontStatus.textContent = this.#queryLocalFonts
			? '打开任意字体下拉时，将自动请求授权并读取本机字体。'
			: '当前浏览器未开放本机字体列表；仍可手动输入字体名称。';
		const footer = settingsFooter(
			document,
			'恢复全部默认',
			{
				rootClass: 'ldp-appearance-footer ldp-font-footer',
				statusClass: 'ldp-appearance-status',
				resetClass: 'ldp-font-reset',
			},
		);
		this.#status = footer.status;
		this.#reset = footer.reset;
		this.scope.listen(this.#reset, 'click', () => {
			this.#draft.setValues(READER_FONT_DRAFT_DEFAULT);
			this.#afterEdit();
		});
		footer.root.prepend(this.#fontStatus);
		this.#host.replaceChildren(content, footer.root);

		const adapter: ReaderSettingsDraftAdapter<TPreferences> = {
			panelId: 'font',
			changeCount: () => this.#draft.changeCount(),
			validate: () => this.#validate(),
			createPatch: () =>
				this.#font.createPatch(settingsFromDraft(this.#draft.read())),
			acceptPersisted: (preferences) => this.#accept(preferences),
			discard: (preferences) => this.#accept(preferences),
		};
		this.scope.add(this.#controller.registerDraft(adapter));
		if (this.#fontCatalog) {
			this.scope.add(this.#fontCatalog.subscribe(() => {
				void this.#loadSharedFonts(true);
			}));
			void this.#loadSharedFonts();
		}
		this.#font.changes.subscribe((snapshot) => {
			if (this.#syncingFont) return;
			const beforeCount = this.#draft.changeCount();
			const rebased = this.#draft.rebase(
				draftFromSettings(this.#font.settings()),
			);
			const afterCount = this.#draft.changeCount();
			const modeChanged = snapshot.mode !== this.#lastMode;
			this.#lastMode = snapshot.mode;
			if (!rebased && beforeCount === afterCount && !modeChanged) return;
			if (afterCount > 0) this.#preview();
			else this.#updateFont(() => this.#font.clearPreview());
			this.#sync();
			this.#controller.refresh();
		}, this.scope);
		this.scope.add(() => {
			this.#fontQueryEpoch += 1;
			this.#updateFont(() => this.#font.clearPreview());
			this.#inputs.clear();
			this.#selects.clear();
			this.#values.clear();
			this.#scopePanels.clear();
			this.#scopeTabs.clear();
			this.#sharedFonts = Object.freeze([]);
			this.#host.replaceChildren();
		});
		this.#syncScope();
		this.#sync();
	}

	#renderFontLibrary(document: Document): HTMLElement {
		const section = settingsSection(
			document,
			'共享字体库',
			'保留浏览器本机字体，可导入 WOFF2、WOFF、TTF 或 OTF 文件，并提供精选 Google Fonts。Google 字体只在选中时联网；导入文件仅保存在当前设备。',
		);
		const list = element(
			document,
			'div',
			'ldp-settings-fields ldp-settings-category-list',
		);
		const importRow = element(document, 'div', 'ldp-setting-row');
		const importCopy = settingsCopy(
			document,
			'ldp-appearance-copy',
			'导入字体文件',
			'单个文件最大 32 MB，最多 64 个。请确保你有权在本机使用该字体。',
		);
		const importButton = settingsButton(
			document,
			'ldp-config-action',
			'',
			'upload',
			'导入字体',
		);
		const file = element(document, 'input', 'ldp-config-file');
		file.type = 'file';
		file.accept = '.woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf';
		file.hidden = true;
		this.#importFile = file;
		this.scope.listen(importButton, 'click', () => {
			file.value = '';
			file.click();
		});
		this.scope.listen(file, 'change', () => void this.#importFont());
		const importControl = element(document, 'span', 'ldp-font-option-control');
		importControl.append(importButton, file);
		importRow.append(importCopy, importControl);

		const removeRow = element(document, 'div', 'ldp-setting-row');
		const removeCopy = settingsCopy(
			document,
			'ldp-appearance-copy',
			'已导入字体',
			'删除后，正在使用该字体的范围会恢复默认字体。',
		);
		const imported = element(document, 'select', 'ldp-font-weight-select');
		imported.setAttribute('aria-label', '选择要删除的已导入字体');
		imported.dataset.fontImportedSelect = 'true';
		this.#importedSelect = imported;
		const remove = settingsButton(
			document,
			'ldp-font-field-reset',
			'删除所选导入字体',
			'trash',
			'删除',
		);
		remove.disabled = true;
		this.#removeImported = remove;
		this.scope.listen(imported, 'change', () => {
			remove.disabled = !imported.value;
		});
		this.scope.listen(remove, 'click', () => void this.#removeImportedFont());
		const removeControl = element(document, 'span', 'ldp-font-option-control');
		removeControl.append(imported, remove);
		removeRow.append(removeCopy, removeControl);
		list.append(importRow, removeRow);
		section.append(list);
		return section;
	}

	destroy(): void {
		this.scope.destroy();
	}

	#renderRendering(document: Document): HTMLElement {
		const section = settingsSection(
			document,
			'字体显示优化',
			'控制增强阅读器及原站页面是否启用内置的字体平滑与渲染优化。',
		);
		const fields = element(
			document,
			'div',
			'ldp-settings-fields ldp-settings-category-list ldp-font-rendering-settings',
		);
		for (const [name, label, description] of [
			[
				'fontRenderingEnabled',
				'启用字体显示优化',
				'在增强阅读器中启用内置的字体平滑与渲染优化。',
			],
			[
				'fontRenderingOnHost',
				'同时应用到原站页面',
				'默认开启；主题列表、帖子原页和其他原站界面也使用相同优化。',
			],
		] as const) {
			const row = element(document, 'label', 'ldp-setting-row');
			const copy = settingsCopy(
				document,
				'ldp-appearance-copy',
				label,
				description,
			);
			const toggle = settingsSwitch(document, label);
			const input = toggle.input;
			input.dataset.fontSetting = name;
			this.#inputs.set(name, input);
			this.scope.listen(input, 'change', () => {
				this.#edit(name, input.checked);
			});
			row.append(copy, toggle.root);
			fields.append(row);
		}
		section.append(fields);
		return section;
	}

	#renderHostSizes(document: Document): HTMLElement {
		const section = settingsSection(
			document,
			'嵌入阅读列表元素大小',
			'使用左右嵌入阅读时，分别调整原站主题列表中的标题、头像、统计信息和标签卡片。',
		);
		const fields = element(
			document,
			'div',
			'ldp-settings-fields ldp-settings-category-list ldp-host-embed-size-settings',
		);
		for (const field of HOST_SIZE_FIELDS) {
			fields.append(this.#rangeRow(
				document,
				field.name,
				field.title,
				READER_HOST_FONT_SCALE_LIMITS.min,
				READER_HOST_FONT_SCALE_LIMITS.max,
			));
		}
		section.append(fields);
		return section;
	}

	#renderScopes(document: Document): HTMLElement {
		const section = element(
			document,
			'section',
			'ldp-settings-category-group ldp-font-settings-fields',
		);
		const tabs = element(document, 'div', 'ldp-font-scope-tabs');
		tabs.role = 'tablist';
		tabs.setAttribute('aria-label', '字体作用范围');
		for (const scope of Object.keys(SCOPE_FIELDS) as ReaderFontScope[]) {
			const config = SCOPE_FIELDS[scope];
			const tab = element(document, 'button', 'ldp-font-scope-tab');
			tab.type = 'button';
			tab.role = 'tab';
			tab.dataset.fontScopeTab = scope;
			tab.textContent = config.label;
			this.#scopeTabs.set(scope, tab);
			this.scope.listen(tab, 'click', () => {
				this.#activeScope = scope;
				this.#syncScope();
			});
			tabs.append(tab);
			const panel = element(
				document,
				'div',
				'ldp-setting-group ldp-font-scope-group',
			);
			panel.role = 'tabpanel';
			panel.dataset.fontScopePanel = scope;
			panel.append(this.#familyRow(document, scope));
			panel.append(this.#weightRow(document, config.weight));
			panel.append(this.#colorRow(document, config.color));
			if (config.scale) {
				panel.append(this.#rangeRow(
					document,
					config.scale,
					'字号',
					READER_FONT_SCALE_LIMITS.min,
					READER_FONT_SCALE_LIMITS.max,
				));
			}
			this.#scopePanels.set(scope, panel);
			section.append(panel);
		}
		section.prepend(tabs);
		return section;
	}

	#familyRow(document: Document, scope: ReaderFontScope): HTMLElement {
		const config = SCOPE_FIELDS[scope];
		const row = element(document, 'label', 'ldp-setting-row');
		const title = element(document, 'strong');
		title.textContent = '字体';
		const control = element(document, 'span', 'ldp-font-option-control');
		const select = element(document, 'select', 'ldp-font-weight-select');
		select.dataset.fontSetting = config.family;
		select.dataset.readerSelectSearchable = 'true';
		select.dataset.readerSelectSearchLabel = this.#queryLocalFonts
			? '搜索字体（尚未获取本机字体）'
			: '搜索预设字体';
		select.setAttribute('aria-label', `${config.label}字体`);
		const presets = element(document, 'optgroup');
		presets.label = '预设字体';
		for (const family of READER_FONT_FAMILIES) {
			const option = appendOption(
				document,
				presets,
				family,
				READER_FONT_FAMILY_LABELS[family],
			);
			addFontPreview(
				option,
				family === 'site' ? 'inherit' : readerFontFamilyCss(family),
			);
		}
		select.append(presets);
		this.#selects.set(config.family, select);
		this.scope.listen(select, READER_SELECT_OPEN_EVENT, () => {
			void this.#loadLocalFonts();
		});
		this.scope.listen(select, 'change', () => {
			const value = selectedValue(select);
			const catalogId = readReaderFontCatalogValue(value);
			if (catalogId !== null) {
				const entry = this.#fontCatalog?.entry(catalogId);
				if (!entry) return;
				const familyChanged = this.#draft.set(config.family, 'custom');
				const customChanged = this.#draft.set(
					config.customFamily,
					entry.family,
				);
				if (familyChanged || customChanged) this.#afterEdit();
				void this.#ensureCatalogFont(entry);
				return;
			}
			const localFont = readLocalFontValue(value);
			if (localFont !== null) {
				const familyChanged = this.#draft.set(config.family, 'custom');
				const customChanged = this.#draft.set(
					config.customFamily,
					localFont,
				);
				if (familyChanged || customChanged) this.#afterEdit();
				return;
			}
			this.#edit(config.family, value as ReaderFontFamily);
		});
		const custom = element(document, 'input', 'ldp-font-family-custom');
		custom.type = 'text';
		custom.maxLength = 64;
		custom.placeholder = '输入、读取或导入字体';
		custom.dataset.fontSetting = config.customFamily;
		custom.dataset.fontCustom = 'true';
		this.#inputs.set(config.customFamily, custom);
		this.scope.listen(custom, 'input', () => {
			this.#edit(config.customFamily, custom.value);
		});
		control.append(
			select,
			custom,
			this.#fieldReset(
				document,
				config.family,
				'恢复字体默认值',
				config.customFamily,
			),
		);
		row.append(title, control);
		return row;
	}

	#weightRow(
		document: Document,
		name: typeof SCOPE_FIELDS[ReaderFontScope]['weight'],
	): HTMLElement {
		const row = element(document, 'label', 'ldp-setting-row');
		const title = element(document, 'strong');
		title.textContent = '字重';
		const select = element(document, 'select', 'ldp-font-weight-select');
		select.dataset.fontSetting = name;
		for (const weight of READER_FONT_WEIGHTS) {
			appendOption(document, select, String(weight), WEIGHT_LABELS[weight]);
		}
		this.#selects.set(name, select);
		this.scope.listen(select, 'change', () => {
			this.#edit(name, Number(select.value) as ReaderFontWeight);
		});
		const control = element(document, 'span', 'ldp-font-option-control');
		control.append(
			select,
			this.#fieldReset(document, name, '恢复字重默认值'),
		);
		row.append(title, control);
		return row;
	}

	#colorRow(
		document: Document,
		name: typeof SCOPE_FIELDS[ReaderFontScope]['color'],
	): HTMLElement {
		const row = element(document, 'label', 'ldp-setting-row');
		const title = element(document, 'strong');
		title.textContent = '文字颜色';
		const control = element(document, 'span', 'ldp-color-control');
		const input = element(document, 'input');
		input.type = 'color';
		input.dataset.fontSetting = name;
		this.#inputs.set(name, input);
		this.scope.listen(input, 'input', () => {
			this.#edit(name, input.value.toLowerCase());
		});
		const value = element(document, 'span', 'ldp-font-color-value');
		value.dataset.fontValue = name;
		this.#values.set(name, value);
		const clear = element(document, 'button', 'ldp-color-reset');
		clear.type = 'button';
		clear.textContent = '跟随主题';
		this.scope.listen(clear, 'click', () => this.#edit(name, ''));
		control.append(input, value, clear);
		row.append(title, control);
		return row;
	}

	#rangeRow(
		document: Document,
		name:
			| typeof HOST_SIZE_FIELDS[number]['name']
			| 'interface'
			| 'post'
			| 'composer',
		titleText: string,
		minimum: number,
		maximum: number,
	): HTMLElement {
		const row = element(document, 'label', 'ldp-setting-row');
		const title = element(document, 'strong');
		title.textContent = titleText;
		const control = element(document, 'span', 'ldp-font-scale-control');
		const input = element(document, 'input', 'ldp-font-scale-range');
		input.type = 'range';
		input.min = String(minimum);
		input.max = String(maximum);
		input.step = '1';
		input.dataset.fontSetting = name;
		this.#inputs.set(name, input);
		this.scope.listen(input, 'input', () => {
			this.#edit(
				name,
				Math.min(maximum, Math.max(minimum, Math.round(
					Number(input.value),
				))),
			);
		});
		const value = element(document, 'span', 'ldp-font-scale-value');
		value.dataset.fontValue = name;
		this.#values.set(name, value);
		control.append(
			input,
			value,
			this.#fieldReset(document, name, `恢复${titleText}默认值`),
		);
		row.append(title, control);
		return row;
	}

	#fieldReset(
		document: Document,
		name: ReaderFontSettingName,
		label: string,
		linkedName?: ReaderFontSettingName,
	): HTMLButtonElement {
		const button = settingsButton(
			document,
			'ldp-font-field-reset',
			label,
			'rotate-ccw',
			'恢复默认',
		);
		button.dataset.fontReset = name;
		this.scope.listen(button, 'click', () => {
			const changed = this.#draft.set(
				name,
				READER_FONT_DRAFT_DEFAULT[name],
			);
			const linkedChanged = linkedName
				? this.#draft.set(
					linkedName,
					READER_FONT_DRAFT_DEFAULT[linkedName],
				)
				: false;
			if (changed || linkedChanged) this.#afterEdit();
		});
		return button;
	}

	#edit<TName extends ReaderFontSettingName>(
		name: TName,
		value: ReaderFontDraft[TName],
	): void {
		if (!this.#draft.set(name, value)) return;
		this.#afterEdit();
	}

	#afterEdit(): void {
		this.#preview();
		this.#sync();
		this.#controller.refresh();
	}

	#preview(): void {
		this.#updateFont(() => this.#font.preview(
			settingsFromDraft(this.#draft.read()),
		));
	}

	#accept(preferences: Readonly<TPreferences>): void {
		this.#draft.accept(draftFromSettings(
			this.#font.readSettings(preferences),
		));
		this.#updateFont(() => this.#font.clearPreview());
		this.#sync();
	}

	#validate(): readonly string[] {
		const values = this.#draft.read();
		const errors: string[] = [];
		for (const name of [
			'interfaceColor',
			'postColor',
			'composerColor',
			'hostFontColor',
		] as const) {
			if (values[name] && !/^#[0-9a-f]{6}$/i.test(values[name])) {
				errors.push(`${name} 必须为空或 6 位十六进制颜色`);
			}
		}
		for (const scope of Object.values(SCOPE_FIELDS)) {
			if (
				values[scope.family] === 'custom' &&
				!String(values[scope.customFamily]).trim()
			) errors.push(`${scope.label}的自定义字体名称不能为空`);
		}
		return Object.freeze(errors);
	}

	async #loadSharedFonts(force = false): Promise<void> {
		const catalog = this.#fontCatalog;
		if (!catalog || this.scope.destroyed) return;
		try {
			const entries = await catalog.entries();
			if (this.scope.destroyed) return;
			if (!force && entries === this.#sharedFonts) return;
			this.#sharedFonts = entries;
			for (const scope of Object.values(SCOPE_FIELDS)) {
				const select = this.#selects.get(scope.family);
				if (!select) continue;
				for (const previous of select.querySelectorAll(
					'optgroup[data-font-catalog-group]',
				)) previous.remove();
				const localGroup = select.querySelector(
					'optgroup[data-font-local-group="true"]',
				);
				for (const source of ['google', 'imported'] as const) {
					const available = entries.filter((entry) =>
						entry.source === source);
					if (!available.length) continue;
					const group = element(this.#host.ownerDocument, 'optgroup');
					group.dataset.fontCatalogGroup = source;
					group.label = source === 'google'
						? `精选 Google Fonts · ${available.length}`
						: `导入字体 · ${available.length}`;
					for (const entry of available) {
						const option = settingsOption(
							this.#host.ownerDocument,
							readerFontCatalogValue(entry.id),
							entry.label,
						);
						option.dataset.fontCatalog = entry.source;
						addFontPreview(
							option,
							entry.fontFamilyCss,
							entry.searchText,
						);
						group.append(option);
					}
					select.insertBefore(group, localGroup);
				}
			}
			this.#syncImportedManagement();
			this.#sync();
			this.#updateFontSearchLabels();
			this.#fontStatus.textContent = this.#fontCatalogStatus();
			const EventConstructor =
				this.#host.ownerDocument.defaultView?.Event ?? Event;
			for (const scope of Object.values(SCOPE_FIELDS)) {
				this.#selects.get(scope.family)?.dispatchEvent(new EventConstructor(
					READER_SELECT_OPTIONS_CHANGE_EVENT,
					{ bubbles: true },
				));
			}
			for (const scope of Object.values(SCOPE_FIELDS)) {
				const values = this.#draft.read();
				if (values[scope.family] !== 'custom') continue;
				const entry = catalog.findByFamily(
					String(values[scope.customFamily]),
				);
				if (entry) void this.#ensureCatalogFont(entry, false);
			}
		} catch {
			this.#fontStatus.textContent =
				'导入字体库暂时不可用；本机字体和 Google Fonts 仍可选择。';
		}
	}

	#syncImportedManagement(): void {
		const select = this.#importedSelect;
		const remove = this.#removeImported;
		if (!select || !remove) return;
		const selected = select.value;
		select.replaceChildren();
		const imported = this.#sharedFonts.filter((entry) =>
			entry.source === 'imported');
		if (!imported.length) {
			appendOption(this.#host.ownerDocument, select, '', '暂无导入字体');
			select.disabled = true;
			remove.disabled = true;
			return;
		}
		for (const entry of imported) {
			appendOption(this.#host.ownerDocument, select, entry.id, entry.label);
		}
		select.disabled = false;
		selectValue(
			select,
			imported.some((entry) => entry.id === selected)
				? selected
				: imported[0]!.id,
		);
		remove.disabled = false;
	}

	async #importFont(): Promise<void> {
		const file = this.#importFile?.files?.[0];
		const catalog = this.#fontCatalog;
		if (!file || !catalog) return;
		this.#fontStatus.textContent = `正在验证并导入 ${file.name}…`;
		try {
			const entry = await catalog.importFile(file);
			if (this.scope.destroyed) return;
			await this.#loadSharedFonts(true);
			const scope = SCOPE_FIELDS[this.#activeScope];
			this.#draft.set(scope.family, 'custom');
			this.#draft.set(scope.customFamily, entry.family);
			this.#afterEdit();
			this.#fontStatus.textContent =
				`已导入并应用 ${entry.label}；文件仅保存在当前设备。`;
		} catch (cause) {
			this.#fontStatus.textContent = cause instanceof Error
				? `导入失败：${cause.message}`
				: '导入字体失败';
		}
	}

	async #removeImportedFont(): Promise<void> {
		const id = this.#importedSelect?.value ?? '';
		const catalog = this.#fontCatalog;
		const entry = catalog?.entry(id);
		if (!catalog || entry?.source !== 'imported') return;
		this.#fontStatus.textContent = `正在删除 ${entry.label}…`;
		try {
			const values = this.#draft.read();
			let changed = false;
			for (const scope of Object.values(SCOPE_FIELDS)) {
				if (
					values[scope.family] !== 'custom' ||
					values[scope.customFamily] !== entry.family
				) continue;
				changed = this.#draft.set(
					scope.family,
					READER_FONT_DRAFT_DEFAULT[scope.family],
				) || changed;
				changed = this.#draft.set(
					scope.customFamily,
					READER_FONT_DRAFT_DEFAULT[scope.customFamily],
				) || changed;
			}
			await catalog.removeImported(id);
			await this.#loadSharedFonts(true);
			if (changed) this.#afterEdit();
			this.#fontStatus.textContent = `已删除 ${entry.label}。`;
		} catch (cause) {
			this.#fontStatus.textContent = cause instanceof Error
				? `删除失败：${cause.message}`
				: '删除导入字体失败';
		}
	}

	async #ensureCatalogFont(
		entry: ReaderFontCatalogEntry,
		report = true,
	): Promise<void> {
		const catalog = this.#fontCatalog;
		if (!catalog) return;
		if (report) {
			this.#fontStatus.textContent = entry.source === 'google'
				? `正在从 Google Fonts 加载 ${entry.label}…`
				: `正在读取已导入字体 ${entry.label}…`;
		}
		const loaded = await catalog.ensureLoaded(entry.id);
		if (this.scope.destroyed) return;
		if (loaded) {
			if (report) this.#fontStatus.textContent = `已加载 ${entry.label}。`;
		} else if (report) {
			this.#fontStatus.textContent =
				`${entry.label} 加载失败，已保留系统字体回退。`;
		}
	}

	#fontCatalogStatus(): string {
		const google = this.#sharedFonts.filter((entry) =>
			entry.source === 'google').length;
		const imported = this.#sharedFonts.length - google;
		const local = this.#queryLocalFonts
			? this.#localFontCount === null
				? '本机字体待授权读取'
				: `本机 ${this.#localFontCount} 种`
			: '浏览器未开放本机字体列表';
		return `可用精选 Google Fonts ${google} 种、导入字体 ${imported} 种；${local}。`;
	}

	#updateFontSearchLabels(): void {
		const google = this.#sharedFonts.filter((entry) =>
			entry.source === 'google').length;
		const imported = this.#sharedFonts.length - google;
		const local = this.#queryLocalFonts
			? this.#localFontCount === null ? '本机待获取' : `本机 ${this.#localFontCount}`
			: '';
		const parts = [
			google ? `Google ${google}` : '',
			imported ? `导入 ${imported}` : '',
			local,
		].filter(Boolean);
		for (const scope of Object.values(SCOPE_FIELDS)) {
			const select = this.#selects.get(scope.family);
			if (select) {
				select.dataset.readerSelectSearchLabel = parts.length
					? `搜索字体 · ${parts.join(' · ')}`
					: '搜索预设字体';
			}
		}
	}

	async #loadLocalFonts(): Promise<void> {
		if (
			!this.#queryLocalFonts ||
			this.#localFontsLoaded ||
			this.#localFontsLoading
		) return;
		const epoch = ++this.#fontQueryEpoch;
		this.#localFontsLoading = true;
		this.#fontStatus.textContent = '正在请求浏览器本机字体权限…';
		try {
			const fonts = [...new Set(
				(await this.#queryLocalFonts())
					.map((name) => String(name).trim())
					.filter(Boolean),
			)]
				.map(readerLocalFontPresentation)
				.sort((left, right) => left.label.localeCompare(
					right.label,
					'zh-CN',
					{ numeric: true, sensitivity: 'base' },
				));
			this.#localFontCount = fonts.length;
			if (epoch !== this.#fontQueryEpoch || this.scope.destroyed) return;
			this.#fontList.replaceChildren();
			for (const font of fonts) {
				const option = element(this.#host.ownerDocument, 'option');
				option.value = font.family;
				this.#fontList.append(option);
			}
			for (const scope of Object.values(SCOPE_FIELDS)) {
				const select = this.#selects.get(scope.family);
				if (!select) continue;
				for (const previous of select.querySelectorAll(
					'optgroup[data-font-local-group="true"]',
				)) previous.remove();
				const localFonts = element(
					this.#host.ownerDocument,
					'optgroup',
				);
				localFonts.label = `本机字体 · ${fonts.length}`;
				localFonts.dataset.fontLocalGroup = 'true';
				for (const font of fonts) {
					const option = settingsOption(
						this.#host.ownerDocument,
						localFontValue(font.family),
						font.label,
					);
					option.dataset.fontLocal = 'true';
					addFontPreview(
						option,
						font.fontFamilyCss,
						font.searchText,
					);
					localFonts.append(option);
				}
				select.append(localFonts);
			}
			this.#sync();
			this.#updateFontSearchLabels();
			this.#localFontsLoaded = true;
			this.#localFontsLoading = false;
			this.#fontStatus.textContent = this.#fontCatalog
				? this.#fontCatalogStatus()
				: fonts.length
					? `已获取 ${fonts.length} 个本机字体；下拉列表已显示字体预览。`
					: '浏览器未返回可用本机字体。';
			const EventConstructor =
				this.#host.ownerDocument.defaultView?.Event ?? Event;
			for (const scope of Object.values(SCOPE_FIELDS)) {
				this.#selects.get(scope.family)?.dispatchEvent(new EventConstructor(
					READER_SELECT_OPTIONS_CHANGE_EVENT,
					{ bubbles: true },
				));
			}
		} catch {
			if (epoch !== this.#fontQueryEpoch || this.scope.destroyed) return;
			this.#fontStatus.textContent =
				'未获得本机字体权限；重新打开字体下拉可再次授权。';
			this.#localFontsLoading = false;
		}
	}

	#updateFont(update: () => void): void {
		this.#syncingFont = true;
		try {
			update();
		} finally {
			this.#syncingFont = false;
		}
	}

	#syncScope(): void {
		for (const [scope, panel] of this.#scopePanels) {
			const active = scope === this.#activeScope;
			panel.hidden = !active;
			const tab = this.#scopeTabs.get(scope);
			if (!tab) continue;
			tab.classList.toggle('active', active);
			tab.setAttribute('aria-selected', String(active));
			tab.tabIndex = active ? 0 : -1;
		}
	}

	#sync(): void {
		const values = this.#draft.read();
		for (const name of ALL_NAMES) {
			const input = this.#inputs.get(name);
			if (input) {
				if (input.type === 'checkbox') {
					input.checked = Boolean(values[name]);
				} else if (input.type === 'color') {
					input.value = String(values[name] || '#000000');
				} else {
					input.value = String(values[name]);
				}
			}
			const select = this.#selects.get(name);
			if (select) {
				const scope = Object.values(SCOPE_FIELDS).find(
					(entry) => entry.family === name,
				);
				const customFamily = scope && values[scope.family] === 'custom'
					? String(values[scope.customFamily]).trim()
					: '';
				const catalogEntry = customFamily
					? this.#fontCatalog?.findByFamily(customFamily) ?? null
					: null;
				const customValue = catalogEntry
					? readerFontCatalogValue(catalogEntry.id)
					: customFamily
						? localFontValue(customFamily)
						: '';
				selectValue(
					select,
					customValue && [...select.options].some(
						(option) => option.value === customValue,
					)
						? customValue
						: String(values[name]),
				);
			}
			const value = this.#values.get(name);
			if (value) {
				value.textContent = name.toLowerCase().includes('color')
					? String(values[name] || '跟随主题').toUpperCase()
					: `${values[name]}%`;
			}
		}
		for (const scope of Object.values(SCOPE_FIELDS)) {
			const custom = this.#inputs.get(scope.customFamily);
			if (custom) custom.hidden = values[scope.family] !== 'custom';
		}
		const external = this.#font.snapshot.mode === 'external';
		const rendering = this.#inputs.get('fontRenderingEnabled');
		const hostRendering = this.#inputs.get('fontRenderingOnHost');
		if (rendering) rendering.disabled = external;
		if (hostRendering) {
			hostRendering.disabled =
				external || !values.fontRenderingEnabled;
		}
		this.#fontStatus.dataset.mode = this.#font.snapshot.mode;
		const changeCount = this.#draft.changeCount();
		this.#status.textContent = changeCount > 0
			? `正在实时预览 ${changeCount} 项字体更改，等待统一保存。`
			: '当前字体配置已应用。';
		this.#reset.disabled = ALL_NAMES.every((name) =>
			Object.is(
				values[name],
				READER_FONT_DRAFT_DEFAULT[name],
			),
		);
	}
}
