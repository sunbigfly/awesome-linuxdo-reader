import { LifecycleScope } from '../kernel/lifecycle.js';
import {
	READER_JUMP_HIGHLIGHT_DEFAULTS,
	READER_JUMP_HIGHLIGHT_LIMITS,
	type ReaderLoadingAnimation,
	type ReaderPreferences,
} from '../state/reader-preferences-schema.js';
import {
	READER_LOADING_ANIMATION_DEFINITIONS,
	renderReaderLoadingVisual,
	selectReaderLoadingAnimation,
	type ReaderLoadingAnimationKey,
} from '../motion/reader-loading-animation-view.js';
import type {
	ReaderTopicNavigationPreferenceProjection,
	ReaderTopicNavigationPreferences,
} from '../topic/reader-topic-navigation-preferences.js';
import type {
	ReaderSettingsController,
	ReaderSettingsDraftAdapter,
} from './reader-settings-controller.js';
import {
	settingsElement as element,
	settingsFooter,
	settingsOption,
	settingsSection,
} from './reader-settings-dom.js';
import { ReaderObjectSettingsDraft } from './reader-object-settings-draft.js';
import type { Signal } from '../kernel/signal.js';

export interface ReaderMotionSettings
	extends ReaderTopicNavigationPreferences {
	readonly loadingAnimation: ReaderLoadingAnimation;
}

export interface ReaderMotionPreferencesAdapter<TPreferences extends object> {
	read(preferences: Readonly<TPreferences>): ReaderMotionSettings;
	createPatch(settings: ReaderMotionSettings): Partial<TPreferences>;
}

export const readerPreferencesMotionAdapter = Object.freeze<
	ReaderMotionPreferencesAdapter<ReaderPreferences>
>({
	read: (preferences) => Object.freeze({
		loadingAnimation: preferences.loadingAnimation,
		jumpHighlightColor: preferences.jumpHighlightColor,
		jumpHighlightRadius: preferences.jumpHighlightRadius,
		jumpHighlightBorderWidth: preferences.jumpHighlightBorderWidth,
		jumpHighlightRate: preferences.jumpHighlightRate,
		jumpHighlightCount: preferences.jumpHighlightCount,
	}),
	createPatch: (settings) => Object.freeze({ ...settings }),
});

export interface ReaderMotionSettingsFormOptions<TPreferences extends object> {
	readonly document: Document;
	readonly host: HTMLElement;
	readonly controller: ReaderSettingsController<TPreferences>;
	readonly navigation: ReaderTopicNavigationPreferenceProjection;
	readonly preferences: ReaderMotionPreferencesAdapter<TPreferences>;
	readonly readPreferences: () => Readonly<TPreferences>;
	readonly preferenceChanges: Pick<
		Signal<Readonly<TPreferences>>,
		'subscribe'
	>;
	readonly random?: () => number;
	readonly parentScope?: LifecycleScope;
}

type MotionSettingName = keyof ReaderMotionSettings;
type JumpNumericName =
	| 'jumpHighlightRadius'
	| 'jumpHighlightBorderWidth'
	| 'jumpHighlightRate'
	| 'jumpHighlightCount';

const MOTION_SETTING_NAMES = Object.freeze<readonly MotionSettingName[]>([
	'loadingAnimation',
	'jumpHighlightColor',
	'jumpHighlightRadius',
	'jumpHighlightBorderWidth',
	'jumpHighlightRate',
	'jumpHighlightCount',
]);

const DEFAULT_SETTINGS = Object.freeze<ReaderMotionSettings>({
	loadingAnimation: 'quoteecho',
	jumpHighlightColor: READER_JUMP_HIGHLIGHT_DEFAULTS.color,
	jumpHighlightRadius: READER_JUMP_HIGHLIGHT_DEFAULTS.radius,
	jumpHighlightBorderWidth:
		READER_JUMP_HIGHLIGHT_DEFAULTS.borderWidth,
	jumpHighlightRate: READER_JUMP_HIGHLIGHT_DEFAULTS.rate,
	jumpHighlightCount: READER_JUMP_HIGHLIGHT_DEFAULTS.count,
});

const JUMP_FIELDS = Object.freeze([
	Object.freeze({
		name: 'jumpHighlightColor',
		label: '提示颜色',
		type: 'color',
		help: '选择跳转目标楼层的闪烁颜色；提示使用半透明底色避免遮住正文，并用同色细轮廓准确呈现所选颜色。选择时实时预览，统一保存。',
		format: (value: string | number) => String(value),
	}),
	Object.freeze({
		name: 'jumpHighlightRadius',
		label: '提示圆角',
		ariaLabel: '跳转提示圆角',
		type: 'range',
		help: `控制闪烁背景的圆角，可在 ${READER_JUMP_HIGHLIGHT_LIMITS.radius.min}–${READER_JUMP_HIGHLIGHT_LIMITS.radius.max}px 之间调整。拖动时实时预览，统一保存。`,
		format: (value: string | number) => `${value}px`,
	}),
	Object.freeze({
		name: 'jumpHighlightBorderWidth',
		label: '提示轮廓宽度',
		ariaLabel: '跳转提示轮廓宽度',
		type: 'range',
		help: `控制闪烁轮廓的宽度，可在 ${READER_JUMP_HIGHLIGHT_LIMITS.borderWidth.min}–${READER_JUMP_HIGHLIGHT_LIMITS.borderWidth.max}px 之间调整；设为 0px 可关闭边框，颜色跟随闪烁颜色。拖动时实时预览，统一保存。`,
		format: (value: string | number) => `${value}px`,
	}),
	Object.freeze({
		name: 'jumpHighlightRate',
		label: '闪烁速度',
		ariaLabel: '跳转提示闪烁速度',
		type: 'range',
		help: `控制每秒闪烁次数，可在 ${READER_JUMP_HIGHLIGHT_LIMITS.rate.min}–${READER_JUMP_HIGHLIGHT_LIMITS.rate.max} 次/秒之间调整；数值越大闪得越快。拖动时实时预览，统一保存。`,
		format: (value: string | number) =>
			`${Number(value).toFixed(1)} 次/秒`,
	}),
	Object.freeze({
		name: 'jumpHighlightCount',
		label: '闪烁次数',
		ariaLabel: '跳转提示闪烁次数',
		type: 'range',
		help: `控制一次跳转连续闪烁多少次，可在 ${READER_JUMP_HIGHLIGHT_LIMITS.count.min}–${READER_JUMP_HIGHLIGHT_LIMITS.count.max} 次之间调整。拖动时实时预览，统一保存。`,
		format: (value: string | number) => `${value} 次`,
	}),
] as const);

export function readerMotionNavigationPreferences(
	settings: ReaderMotionSettings,
): ReaderTopicNavigationPreferences {
	return Object.freeze({
		jumpHighlightColor: settings.jumpHighlightColor,
		jumpHighlightRadius: settings.jumpHighlightRadius,
		jumpHighlightBorderWidth: settings.jumpHighlightBorderWidth,
		jumpHighlightRate: settings.jumpHighlightRate,
		jumpHighlightCount: settings.jumpHighlightCount,
	});
}

function numericLimit(name: JumpNumericName): Readonly<{
	readonly min: number;
	readonly max: number;
	readonly step: number;
}> {
	const key = name.replace('jumpHighlight', '');
	const normalized = `${key[0]!.toLowerCase()}${key.slice(1)}` as
		keyof typeof READER_JUMP_HIGHLIGHT_LIMITS;
	return READER_JUMP_HIGHLIGHT_LIMITS[normalized];
}

/**
 * 动画选择和跳转高亮草稿的唯一 form owner。
 *
 * 高亮预览仅投影到现有 navigation owner 的 CSS 变量，真实闪烁生命周期仍由 scroll
 * adapter 管理；加载预览与 Shell 加载视图复用同一个 renderer。
 */
export class ReaderMotionSettingsForm<TPreferences extends object> {
	readonly scope: LifecycleScope;
	readonly #host: HTMLElement;
	readonly #controller: ReaderSettingsController<TPreferences>;
	readonly #navigation: ReaderTopicNavigationPreferenceProjection;
	readonly #preferences: ReaderMotionPreferencesAdapter<TPreferences>;
	readonly #readPreferences: () => Readonly<TPreferences>;
	readonly #random: () => number;
	readonly #draft: ReaderObjectSettingsDraft<
		ReaderMotionSettings,
		MotionSettingName
	>;
	readonly #inputs = new Map<MotionSettingName, HTMLInputElement>();
	readonly #values = new Map<MotionSettingName, HTMLElement>();
	readonly #select: HTMLSelectElement;
	readonly #preview: HTMLElement;
	readonly #previewLabel: HTMLElement;
	readonly #reroll: HTMLButtonElement;
	readonly #status: HTMLElement;
	readonly #reset: HTMLButtonElement;
	#previewRandomKey: ReaderLoadingAnimationKey | undefined;

	constructor(options: ReaderMotionSettingsFormOptions<TPreferences>) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#host = options.host;
		this.#controller = options.controller;
		this.#navigation = options.navigation;
		this.#preferences = options.preferences;
		this.#readPreferences = options.readPreferences;
		this.#random = options.random ?? Math.random;
		this.#draft = new ReaderObjectSettingsDraft(
			MOTION_SETTING_NAMES,
			this.#preferences.read(this.#readPreferences()),
		);

		const groups = element(
			options.document,
			'div',
			'ldp-settings-category-groups',
		);
		groups.append(this.#renderJumpGroup(options.document));
		const loadingGroup = this.#renderLoadingGroup(options.document);
		groups.append(loadingGroup.group);
		this.#select = loadingGroup.select;
		this.#preview = loadingGroup.preview;
		this.#previewLabel = loadingGroup.previewLabel;
		this.#reroll = loadingGroup.reroll;

		const footer = settingsFooter(
			options.document,
			'恢复全部默认',
		);
		this.#status = footer.status;
		this.#reset = footer.reset;
		this.scope.listen(this.#reset, 'click', () => {
			this.#draft.setValues(DEFAULT_SETTINGS);
			this.#previewRandomKey = undefined;
			this.#afterEdit();
		});
		this.#host.replaceChildren(groups, footer.root);

		const adapter: ReaderSettingsDraftAdapter<TPreferences> = {
			panelId: 'flash',
			changeCount: () => this.#draft.changeCount(),
			validate: () => this.#validate(),
			createPatch: () =>
				this.#preferences.createPatch(this.#draft.read()),
			acceptPersisted: (preferences) => this.#accept(preferences),
			discard: (preferences) => this.#accept(preferences),
		};
		this.scope.add(this.#controller.registerDraft(adapter));
		options.preferenceChanges.subscribe(
			(preferences) => this.#rebase(preferences),
			this.scope,
		);
		this.scope.add(() => {
			this.#navigation.clearPreview();
			this.#inputs.clear();
			this.#values.clear();
			this.#host.replaceChildren();
		});
		this.#sync();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#renderJumpGroup(document: Document): HTMLElement {
		const section = settingsSection(
			document,
			'跳转楼层提示',
			'跳转到指定楼层时，用短暂闪烁帮助定位目标内容。',
		);
		const fields = element(
			document,
			'div',
			'ldp-settings-fields ldp-flash-fields',
		);
		for (const field of JUMP_FIELDS) {
			const row = element(document, 'label', 'ldp-setting-row');
			row.dataset.settingHelp = field.help;
			const label = element(document, 'span', 'ldp-setting-label');
			label.textContent = field.label;
			const control = element(
				document,
				'span',
				field.type === 'color'
					? 'ldp-color-control'
					: 'ldp-flash-range-control',
			);
			const input = element(document, 'input');
			input.type = field.type;
			input.className = field.type === 'color'
				? 'ldp-flash-color'
				: `ldp-flash-${field.name.replace('jumpHighlight', '')
					.replace(/^./, (initial) => initial.toLowerCase())} ldp-flash-range`;
			input.setAttribute(
				'aria-label',
				'ariaLabel' in field ? field.ariaLabel : field.label,
			);
			input.dataset.motionSetting = field.name;
			if (field.type === 'range') {
				const limit = numericLimit(field.name as JumpNumericName);
				input.min = String(limit.min);
				input.max = String(limit.max);
				input.step = String(limit.step);
			}
			this.#inputs.set(field.name, input);
			this.scope.listen(input, 'input', () => {
				this.#edit(
					field.name,
					field.type === 'color'
						? input.value.toLowerCase()
						: Number(input.value),
				);
			});
			const value = element(
				document,
				field.type === 'color' ? 'span' : 'output',
				field.type === 'color'
					? 'ldp-flash-color-value'
					: `ldp-flash-${field.name.replace('jumpHighlight', '')
						.replace(/^./, (initial) => initial.toLowerCase())}-value ldp-flash-value`,
			);
			value.dataset.motionValue = field.name;
			this.#values.set(field.name, value);
			control.append(input, value);
			row.append(label, control);
			fields.append(row);
		}
		section.append(fields);
		return section;
	}

	#renderLoadingGroup(document: Document): Readonly<{
		readonly group: HTMLElement;
		readonly select: HTMLSelectElement;
		readonly preview: HTMLElement;
		readonly previewLabel: HTMLElement;
		readonly reroll: HTMLButtonElement;
	}> {
		const group = element(document, 'div', 'ldp-motion-settings');
		const section = settingsSection(
			document,
			'加载动画',
			'打开或切换帖子时显示；选择“每次随机”会从 10 种动画中重新抽取。',
		);
		const row = element(
			document,
			'label',
			'ldp-setting-row ldp-motion-choice-row',
		);
		const label = element(document, 'span', 'ldp-setting-label');
		label.textContent = '动画样式';
		const select = element(
			document,
			'select',
			'ldp-reader-select ldp-loading-animation-select',
		);
		select.setAttribute('aria-label', '帖子加载动画样式');
		select.append(settingsOption(
			document,
			'random',
			'每次随机（推荐）',
		));
		for (const definition of READER_LOADING_ANIMATION_DEFINITIONS) {
			select.append(settingsOption(
				document,
				definition.key,
				definition.label,
			));
		}
		this.scope.listen(select, 'change', () => {
			this.#previewRandomKey = undefined;
			const selected = [...select.options].find(
				(option) => option.selected,
			)?.value ?? select.value;
			this.#edit(
				'loadingAnimation',
				selected as ReaderLoadingAnimation,
			);
		});
		this.scope.listen(select, 'wheel', (event) => {
			event.stopPropagation();
		}, { passive: true });
		row.append(label, select);
		section.append(row);

		const previewWrap = element(
			document,
			'div',
			'ldp-loading-settings-preview',
		);
		const previewHead = element(
			document,
			'div',
			'ldp-loading-settings-preview-head',
		);
		const previewCopy = element(document, 'span');
		const previewTitle = element(document, 'strong');
		previewTitle.textContent = '动画预览';
		const previewLabel = element(document, 'small');
		previewCopy.append(previewTitle, previewLabel);
		const reroll = element(
			document,
			'button',
			'ldp-loading-preview-reroll',
		);
		reroll.type = 'button';
		reroll.textContent = '换一个';
		this.scope.listen(reroll, 'click', () => {
			this.#renderLoadingPreview(true);
		});
		previewHead.append(previewCopy, reroll);
		const preview = element(
			document,
			'div',
			'ldp-loading-preview-stage',
		);
		preview.setAttribute('aria-live', 'polite');
		previewWrap.append(previewHead, preview);
		group.append(section, previewWrap);
		return Object.freeze({
			group,
			select,
			preview,
			previewLabel,
			reroll,
		});
	}

	#edit(
		name: MotionSettingName,
		value: ReaderMotionSettings[MotionSettingName],
	): void {
		this.#draft.set(name, value);
		this.#afterEdit();
	}

	#afterEdit(): void {
		this.#previewNavigation();
		this.#sync();
		this.#controller.refresh();
	}

	#previewNavigation(): void {
		if (!this.#draft.dirtyNames().some(
			(name) => name !== 'loadingAnimation',
		)) {
			this.#navigation.clearPreview();
			return;
		}
		this.#navigation.preview(
			readerMotionNavigationPreferences(this.#draft.read()),
		);
	}

	#renderLoadingPreview(reroll = false): void {
		const preference = this.#draft.read().loadingAnimation;
		const excluded = preference === 'random' && reroll
			? this.#previewRandomKey
			: undefined;
		const definition =
			preference === 'random' &&
				!reroll &&
				this.#previewRandomKey
				? READER_LOADING_ANIMATION_DEFINITIONS.find(
					(candidate) =>
						candidate.key === this.#previewRandomKey,
				)!
				: selectReaderLoadingAnimation(
					preference,
					this.#random,
					excluded,
				);
		this.#previewRandomKey = preference === 'random'
			? definition.key
			: undefined;
		this.#preview.replaceChildren(
			renderReaderLoadingVisual(
				this.#preview.ownerDocument,
				definition,
			),
		);
		const number =
			READER_LOADING_ANIMATION_DEFINITIONS.indexOf(definition) + 1;
		this.#previewLabel.textContent =
			`${String(number).padStart(2, '0')} / ` +
			`${READER_LOADING_ANIMATION_DEFINITIONS.length} · ` +
			`${definition.label} · ` +
			(preference === 'random' ? '随机预览' : '固定使用');
		this.#reroll.hidden = preference !== 'random';
	}

	#rebase(preferences: Readonly<TPreferences>): void {
		const previousCount = this.#draft.changeCount();
		const changed = this.#draft.rebase(
			this.#preferences.read(preferences),
		);
		if (
			!changed &&
			this.#draft.changeCount() === previousCount
		) return;
		if (this.#draft.changeCount() > 0) this.#previewNavigation();
		else this.#navigation.clearPreview();
		this.#sync();
		this.#controller.refresh();
	}

	#accept(preferences: Readonly<TPreferences>): void {
		this.#draft.accept(this.#preferences.read(preferences));
		this.#navigation.clearPreview();
		this.#previewRandomKey = undefined;
		this.#sync();
	}

	#validate(): readonly string[] {
		const settings = this.#draft.read();
		const issues: string[] = [];
		if (!/^#[0-9a-f]{6}$/i.test(settings.jumpHighlightColor)) {
			issues.push('跳转提示颜色必须是 6 位十六进制颜色');
		}
		for (const field of JUMP_FIELDS) {
			if (field.type !== 'range') continue;
			const name = field.name as JumpNumericName;
			const limit = numericLimit(name);
			const value = settings[name];
			if (
				!Number.isFinite(value) ||
				value < limit.min ||
				value > limit.max
			) {
				issues.push(`${field.label}超出允许范围`);
			}
		}
		return Object.freeze(issues);
	}

	#sync(): void {
		const settings = this.#draft.read();
		for (const field of JUMP_FIELDS) {
			const input = this.#inputs.get(field.name)!;
			const value = settings[field.name];
			input.value = String(value);
			this.#values.get(field.name)!.textContent = field.format(value);
		}
		for (const option of [...this.#select.options]) {
			option.selected = false;
		}
		const selected = [...this.#select.options].find(
			(option) => option.value === settings.loadingAnimation,
		);
		if (selected) selected.selected = true;
		this.#renderLoadingPreview(false);
		const count = this.#draft.changeCount();
		this.#status.textContent = count
			? `有 ${count} 项未保存`
			: '已与当前设置同步';
		this.#reset.disabled = MOTION_SETTING_NAMES.every((name) =>
			Object.is(settings[name], DEFAULT_SETTINGS[name]),
		);
	}
}
