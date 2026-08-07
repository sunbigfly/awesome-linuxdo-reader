import { LifecycleScope } from '../kernel/lifecycle.js';
import {
	READER_APPEARANCE_COLOR_NAMES,
	READER_APPEARANCE_DEFAULT,
	READER_APPEARANCE_NUMERIC_LIMITS,
	READER_APPEARANCE_SETTING_NAMES,
	normalizeReaderAppearanceProfile,
	readerAppearanceEditableProfile,
	type ReaderAppearanceColorName,
	type ReaderAppearanceEditableProfile,
	type ReaderAppearanceSettingName,
} from '../state/reader-preferences-schema.js';
import type {
	ReaderAppearanceStyleController,
} from '../appearance/reader-appearance-style-controller.js';
import type {
	ReaderSettingsController,
	ReaderSettingsDraftAdapter,
} from './reader-settings-controller.js';
import {
	settingsButton,
	settingsElement as element,
	settingsFooter,
	settingsSwitch,
} from './reader-settings-dom.js';
import { ReaderObjectSettingsDraft } from './reader-object-settings-draft.js';

type AppearanceNumericName = keyof typeof READER_APPEARANCE_NUMERIC_LIMITS;

export interface ReaderAppearanceSettingsFormOptions<
	TPreferences extends object,
> {
	readonly document: Document;
	readonly host: HTMLElement;
	readonly controller: ReaderSettingsController<TPreferences>;
	readonly appearance: ReaderAppearanceStyleController<TPreferences>;
	readonly parentScope?: LifecycleScope;
}

interface AppearanceField {
	readonly name: Exclude<
		ReaderAppearanceSettingName,
		'structureColorsEnabled'
	>;
	readonly title: string;
	readonly description: string;
	readonly subgroup?: string;
	readonly subgroupTitle?: string;
}

interface AppearanceGroup {
	readonly id: string;
	readonly title: string;
	readonly description: string;
	readonly toggle?: true;
	readonly fields: readonly AppearanceField[];
}

const groups = Object.freeze<readonly AppearanceGroup[]>([
	Object.freeze({
		id: 'interaction',
		title: '按钮与链接',
		description: '控制按钮、选中状态、焦点、时间轴和正文链接，不改变错误、警告、成功等状态颜色。',
		fields: Object.freeze([
			Object.freeze({
				name: 'accentColor',
				title: '按钮与选中状态颜色',
				description: '不改变错误、警告、成功和点赞等语义颜色。',
			}),
			Object.freeze({
				name: 'linkColor',
				title: '正文链接颜色',
				description: '与界面强调色分开设置。',
			}),
		]),
	}),
	Object.freeze({
		id: 'background',
		title: '交替内容背景',
		description: '用浅色背景区分相邻楼层，以及嵌入阅读时的原站主题列表卡片。',
		fields: Object.freeze([
			Object.freeze({
				name: 'zebraColor',
				title: '背景颜色',
				description: '按当前明暗主题自动限制亮度与饱和度。',
				subgroup: 'zebra',
				subgroupTitle: '交替楼层背景',
			}),
			Object.freeze({
				name: 'zebraRadius',
				title: '背景圆角',
				description: '只改变交替背景，不改变正文布局。',
				subgroup: 'zebra',
			}),
			Object.freeze({
				name: 'listZebraColor',
				title: '嵌入阅读列表背景',
				description: '只在左右嵌入阅读时投影到原站列表。',
			}),
		]),
	}),
	Object.freeze({
		id: 'structure',
		title: '关系线与分隔线',
		description: '分别控制回复连接线、引用线和界面分隔线；关闭后隐藏这些线条，已设置的样式会保留。',
		toggle: true,
		fields: Object.freeze([
			Object.freeze({
				name: 'replyLineColor',
				title: '颜色',
				description: '用于父子回复、层级提示和特殊正文强调。',
				subgroup: 'reply-line',
				subgroupTitle: '回复连接线',
			}),
			Object.freeze({
				name: 'replyLineWidth',
				title: '粗细',
				description: '可见线与点击热区仍由不同变量控制。',
				subgroup: 'reply-line',
			}),
			Object.freeze({
				name: 'replyLineRadius',
				title: '转角圆角',
				description: '控制父子关系线的转角。',
				subgroup: 'reply-line',
			}),
			Object.freeze({
				name: 'quoteLineColor',
				title: '颜色',
				description: '只改变引用提示线，不改变引用正文。',
				subgroup: 'quote-line',
				subgroupTitle: '引用线',
			}),
			Object.freeze({
				name: 'quoteLineWidth',
				title: '粗细',
				description: '引用样式继续保留原有强调倍数。',
				subgroup: 'quote-line',
			}),
			Object.freeze({
				name: 'dividerLineColor',
				title: '颜色',
				description: '正文、标题栏、面板和嵌入边界共用。',
				subgroup: 'divider-line',
				subgroupTitle: '界面分隔线',
			}),
			Object.freeze({
				name: 'dividerLineWidth',
				title: '粗细',
				description: '按钮与输入框边框不随之改变。',
				subgroup: 'divider-line',
			}),
		]),
	}),
]);

const colorNames = new Set<ReaderAppearanceSettingName>(
	READER_APPEARANCE_COLOR_NAMES,
);

function isColorName(
	name: ReaderAppearanceSettingName,
): name is ReaderAppearanceColorName {
	return colorNames.has(name);
}

function isNumericName(
	name: ReaderAppearanceSettingName,
): name is AppearanceNumericName {
	return Object.hasOwn(READER_APPEARANCE_NUMERIC_LIMITS, name);
}

/**
 * 外观字段与草稿的唯一 form owner。
 *
 * 所有预览只进入 ReaderAppearanceStyleController；form 不直接写 CSS、宿主 page root 或
 * 回复树 SVG，因此保存、放弃、主题变化和 embedded 投影不会出现第二条视觉状态链。
 */
export class ReaderAppearanceSettingsForm<
	TPreferences extends object,
> {
	readonly scope: LifecycleScope;
	readonly #host: HTMLElement;
	readonly #controller: ReaderSettingsController<TPreferences>;
	readonly #appearance: ReaderAppearanceStyleController<TPreferences>;
	readonly #draft: ReaderObjectSettingsDraft<
		ReaderAppearanceEditableProfile,
		ReaderAppearanceSettingName
	>;
	readonly #inputs = new Map<ReaderAppearanceSettingName, HTMLInputElement>();
	readonly #values = new Map<ReaderAppearanceSettingName, HTMLElement>();
	readonly #reset: HTMLButtonElement;
	readonly #status: HTMLElement;
	#syncingAppearance = false;

	constructor(options: ReaderAppearanceSettingsFormOptions<TPreferences>) {
		this.#host = options.host;
		this.#controller = options.controller;
		this.#appearance = options.appearance;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#draft = new ReaderObjectSettingsDraft(
			READER_APPEARANCE_SETTING_NAMES,
			readerAppearanceEditableProfile(this.#appearance.profile()),
		);

		const groupHost = element(
			options.document,
			'div',
			'ldp-settings-category-groups ldp-appearance-groups',
		);
		for (const group of groups) {
			const section = element(
				options.document,
				'section',
				'ldp-settings-category-group ldp-color-group',
			);
			section.dataset.appearanceGroup = group.id;
			const head = element(
				options.document,
				'header',
				'ldp-settings-category-head ldp-color-group-head',
			);
			const copy = element(
				options.document,
				'div',
				'ldp-color-group-head-copy',
			);
			const title = element(
				options.document,
				'h4',
				'ldp-color-group-title',
			);
			title.id = `ldp-color-group-${group.id}`;
			title.textContent = group.title;
			const description = element(
				options.document,
				'p',
				'ldp-color-group-description',
			);
			description.textContent = group.description;
			copy.append(title, description);
			head.append(copy);
			section.setAttribute('aria-labelledby', title.id);
			if (group.toggle) {
				const switchControl = settingsSwitch(
					options.document,
					'显示关系线与分隔线',
				);
				const toggle = switchControl.input;
				toggle.dataset.appearanceSetting = 'structureColorsEnabled';
				const actions = element(
					options.document,
					'span',
					'ldp-color-group-head-actions',
				);
				actions.append(switchControl.root);
				head.append(actions);
				this.#inputs.set('structureColorsEnabled', toggle);
				this.scope.listen(toggle, 'change', () => {
					this.#edit('structureColorsEnabled', toggle.checked);
				});
			}
			const fields = element(
				options.document,
				'div',
				'ldp-settings-fields',
			);
			const subgroups = new Map<string, HTMLElement>();
			for (const field of group.fields) {
				let fieldHost: HTMLElement = fields;
				if (field.subgroup) {
					let subgroup = subgroups.get(field.subgroup);
					if (!subgroup) {
						subgroup = element(
							options.document,
							'div',
							'ldp-setting-group',
						);
						if (field.subgroupTitle) {
							const subgroupTitle = element(
								options.document,
								'div',
								'ldp-setting-group-title',
							);
							subgroupTitle.id =
								`ldp-${field.subgroup}-setting-group-title`;
							subgroupTitle.textContent = field.subgroupTitle;
							subgroup.setAttribute('role', 'group');
							subgroup.setAttribute(
								'aria-labelledby',
								subgroupTitle.id,
							);
							subgroup.append(subgroupTitle);
						}
						fields.append(subgroup);
						subgroups.set(field.subgroup, subgroup);
					}
					fieldHost = subgroup;
				}
				const row = element(
					options.document,
					'div',
					'ldp-setting-row',
				);
				row.dataset.settingHelp = field.description;
				const fieldCopy = element(
					options.document,
					'span',
					'ldp-setting-label',
				);
				fieldCopy.textContent = field.title;
				const control = element(
					options.document,
					'span',
					isColorName(field.name)
						? 'ldp-color-control'
						: 'ldp-font-scale-control',
				);
				const input = element(options.document, 'input');
				input.dataset.appearanceSetting = field.name;
				input.setAttribute('aria-label', field.title);
				if (isColorName(field.name)) {
					input.type = 'color';
				} else if (isNumericName(field.name)) {
					const limit = READER_APPEARANCE_NUMERIC_LIMITS[field.name];
					input.type = 'range';
					input.min = String(limit.min);
					input.max = String(limit.max);
					input.step = String(limit.step);
				}
				const value = element(
					options.document,
					'span',
					'ldp-appearance-value',
				);
				value.dataset.appearanceValue = field.name;
				const reset = settingsButton(
					options.document,
					'ldp-color-reset',
					`恢复${field.title}默认值`,
					'rotate-ccw',
					'恢复默认',
				);
				reset.dataset.appearanceReset = field.name;
				control.append(input, value, reset);
				row.append(fieldCopy, control);
				fieldHost.append(row);
				this.#inputs.set(field.name, input);
				this.#values.set(field.name, value);
				this.scope.listen(input, 'input', () => {
					this.#editInput(field.name, input);
				});
				this.scope.listen(reset, 'click', () => {
					this.#edit(
						field.name,
						readerAppearanceEditableProfile(
							READER_APPEARANCE_DEFAULT,
						)[field.name],
					);
				});
			}
			section.append(head, fields);
			groupHost.append(section);
		}

		const footer = settingsFooter(
			options.document,
			'恢复全部默认',
			{
				rootClass: 'ldp-appearance-footer',
				statusClass: 'ldp-appearance-status',
			},
		);
		this.#status = footer.status;
		this.#reset = footer.reset;
		this.scope.listen(this.#reset, 'click', () => {
			this.#draft.setValues(
				readerAppearanceEditableProfile(READER_APPEARANCE_DEFAULT),
			);
			this.#afterEdit();
		});
		this.#host.replaceChildren(groupHost, footer.root);

		const adapter: ReaderSettingsDraftAdapter<TPreferences> = {
			panelId: 'appearance',
			changeCount: () => this.#draft.changeCount(),
			validate: () => this.#validate(),
			createPatch: () => this.#appearance.createPatch(
				normalizeReaderAppearanceProfile(this.#draft.read()),
			),
			acceptPersisted: (preferences) => this.#accept(preferences),
			discard: (preferences) => this.#accept(preferences),
		};
		this.scope.add(this.#controller.registerDraft(adapter));
		this.#appearance.changes.subscribe(() => {
			if (this.#syncingAppearance) return;
			this.#draft.rebase(
				readerAppearanceEditableProfile(this.#appearance.profile()),
			);
			if (this.#draft.changeCount() > 0) this.#preview();
			else this.#updateAppearance(() => this.#appearance.clearPreview());
			this.#sync();
			this.#controller.refresh();
		}, this.scope);
		this.scope.add(() => {
			this.#updateAppearance(() => this.#appearance.clearPreview());
			this.#inputs.clear();
			this.#values.clear();
			this.#host.replaceChildren();
		});
		this.#sync();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#editInput(
		name: Exclude<ReaderAppearanceSettingName, 'structureColorsEnabled'>,
		input: HTMLInputElement,
	): void {
		if (isColorName(name)) {
			this.#edit(name, input.value.toLowerCase());
			return;
		}
		if (!isNumericName(name)) return;
		const limit = READER_APPEARANCE_NUMERIC_LIMITS[name];
		const parsed = Number(input.value);
		const value = Number.isFinite(parsed)
			? Math.min(
				limit.max,
				Math.max(
					limit.min,
					Math.round(parsed / limit.step) * limit.step,
				),
			)
			: this.#draft.read()[name];
		this.#edit(name, value);
	}

	#edit<TName extends ReaderAppearanceSettingName>(
		name: TName,
		value: ReaderAppearanceEditableProfile[TName],
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
		this.#updateAppearance(() => this.#appearance.preview(
			normalizeReaderAppearanceProfile(this.#draft.read()),
		));
	}

	#accept(preferences: Readonly<TPreferences>): void {
		this.#draft.accept(readerAppearanceEditableProfile(
			this.#appearance.readProfile(preferences),
		));
		this.#updateAppearance(() => this.#appearance.clearPreview());
		this.#sync();
	}

	#validate(): readonly string[] {
		const profile = this.#draft.read();
		const errors: string[] = [];
		for (const name of READER_APPEARANCE_COLOR_NAMES) {
			if (!/^#[0-9a-f]{6}$/i.test(profile[name])) {
				errors.push(`${name} 必须是 6 位十六进制颜色`);
			}
		}
		for (const name of Object.keys(
			READER_APPEARANCE_NUMERIC_LIMITS,
		) as AppearanceNumericName[]) {
			const value = Number(profile[name]);
			const limit = READER_APPEARANCE_NUMERIC_LIMITS[name];
			if (
				!Number.isFinite(value) ||
				value < limit.min ||
				value > limit.max
			) errors.push(`${name} 超出 ${limit.min}..${limit.max}`);
		}
		return Object.freeze(errors);
	}

	#updateAppearance(update: () => void): void {
		this.#syncingAppearance = true;
		try {
			update();
		} finally {
			this.#syncingAppearance = false;
		}
	}

	#sync(): void {
		const profile = this.#draft.read();
		for (const name of READER_APPEARANCE_SETTING_NAMES) {
			const input = this.#inputs.get(name);
			if (!input) continue;
			if (name === 'structureColorsEnabled') {
				input.checked = profile.structureColorsEnabled;
				continue;
			}
			input.value = String(profile[name]);
			const value = this.#values.get(name);
			if (value) {
				value.textContent = isColorName(name)
					? profile[name].toUpperCase()
					: `${profile[name]}${
						name.endsWith('Width') ||
						name.endsWith('Radius')
							? 'px'
							: ''
					}`;
			}
		}
		const changeCount = this.#draft.changeCount();
		this.#status.textContent = changeCount > 0
			? `正在实时预览 ${changeCount} 项外观更改，等待统一保存。`
			: '当前外观配置已应用。';
		this.#status.classList.toggle('balanced', changeCount === 0);
		this.#reset.disabled = READER_APPEARANCE_SETTING_NAMES.every((name) =>
			Object.is(
				profile[name],
				readerAppearanceEditableProfile(
					READER_APPEARANCE_DEFAULT,
				)[name],
			),
		);
	}
}
