import { LifecycleScope } from '../kernel/lifecycle.js';
import {
	READER_AI_REASONING_EFFORT_PRESETS,
	READER_TRANSLATION_ANIMATIONS,
	compareReaderAiModels,
	normalizeReaderTranslationAnimation,
	normalizeReaderTranslationConfig,
	readerAiModelDisplayLabel,
	readerTranslationActiveProfile,
	validateReaderTranslationProfile,
	type ReaderTranslationAnimation,
	type ReaderTranslationConfig,
	type ReaderTranslationConfigRepository,
	type ReaderTranslationProfile,
} from '../translation/reader-translation-config.js';
import {
	DEFAULT_READER_TRANSLATION_THEME,
	READER_TRANSLATION_THEMES,
	normalizeReaderTranslationTheme,
	type ReaderTranslationTheme,
} from '../translation/reader-translation-presentation.js';
import {
	settingsButton,
	settingsElement as element,
	settingsIcon,
	settingsOption,
	settingsOptionRow,
	settingsSection,
} from './reader-settings-dom.js';

const CUSTOM_REASONING_EFFORT = '__custom__';
const PUBLIC_TRANSLATION_MODEL = '__public__';
const SEGMENTED_TRANSLATION_ANIMATIONS = new Set<ReaderTranslationAnimation>([
	'fade',
	'blur',
	'shimmer',
	'spring',
]);

const reasoningEffortLabels = Object.freeze(new Map<string, string>([
	['', '自动（不发送参数）'],
	['none', '关闭（none）'],
	['minimal', '极低（minimal）'],
	['low', '低（low）'],
	['medium', '中（medium）'],
	['high', '高（high）'],
	['xhigh', '极高（xhigh）'],
	['max', '最大（max）'],
]));

export interface ReaderTranslationSettingsFormOptions {
	readonly document: Document;
	readonly host: HTMLElement;
	readonly repository: ReaderTranslationConfigRepository;
	readonly presentation?: Readonly<{
		readonly readTheme: () => ReaderTranslationTheme;
		readonly persistTheme: (theme: ReaderTranslationTheme) => void;
	}>;
	readonly parentScope?: LifecycleScope;
}

function field(
	document: Document,
	label: string,
	type: 'text' | 'number',
	placeholder: string,
): HTMLInputElement {
	const input = element(document, 'input', 'ldp-boost-rule-control');
	input.type = type;
	input.placeholder = placeholder;
	input.setAttribute('aria-label', label);
	input.autocomplete = 'off';
	return input;
}

function selectValue(select: HTMLSelectElement, value: string): void {
	for (const option of [...select.options]) {
		option.toggleAttribute('selected', option.value === value);
	}
}

function selectedValue(select: HTMLSelectElement): string {
	return [...select.options].filter((option) => option.selected).at(-1)?.value ??
		[...select.options].filter((option) =>
			option.hasAttribute('selected')).at(-1)?.value ?? '';
}

function modelSelectionValue(baseUrl: string, model: string): string {
	return JSON.stringify([baseUrl, model]);
}

function parseModelSelection(value: string): Readonly<{
	readonly baseUrl: string;
	readonly model: string;
}> | null {
	if (value === PUBLIC_TRANSLATION_MODEL) return null;
	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed) && parsed.length === 2 &&
			typeof parsed[0] === 'string' && typeof parsed[1] === 'string'
			? Object.freeze({ baseUrl: parsed[0], model: parsed[1] })
			: null;
	} catch {
		return null;
	}
}

interface TranslationSettingsPreview {
	readonly root: HTMLElement;
	readonly output: HTMLElement;
}

function renderAnimationPreviewText(
	document: Document,
	output: HTMLElement,
): void {
	output.replaceChildren(...[
		'知识',
		'会在',
		'分享中',
		'不断生长。',
	].map((text, index) => {
		const segment = element(document, 'span', 'ldp-translation-segment');
		segment.textContent = text;
		segment.style.setProperty(
			'--ldp-translation-segment-delay',
			`${index * 120}ms`,
		);
		return segment;
	}));
}

function translationSettingsPreview(
	document: Document,
	kind: 'theme' | 'animation',
): TranslationSettingsPreview {
	const root = element(
		document,
		'div',
		'ldp-translation-settings-preview ldp-translation-active',
	);
	root.dataset.previewKind = kind;
	root.setAttribute('aria-label', kind === 'theme'
		? '译文样式效果预览'
		: '译文动画效果预览');
	const label = element(document, 'small', 'ldp-translation-preview-label');
	label.textContent = kind === 'theme' ? '样式预览' : '动画预览';
	const content = element(document, 'span', 'ldp-translation-preview-content');
	const original = element(document, 'span', 'ldp-translation-original');
	original.textContent = 'Knowledge grows when ideas are shared.';
	const output = element(document, 'span', 'ldp-translation-text');
	if (kind === 'animation') renderAnimationPreviewText(document, output);
	else output.textContent = '知识会在分享中不断生长。';
	content.append(original, output);
	root.append(label, content);
	return Object.freeze({ root, output });
}

function previewControl(
	document: Document,
	select: HTMLSelectElement,
	preview: HTMLElement,
): HTMLElement {
	const control = element(document, 'span', 'ldp-translation-preview-control');
	control.append(select, preview);
	return control;
}

/** 译文呈现与当前 AI 服务翻译参数的唯一设置 DOM owner。 */
export class ReaderTranslationSettingsForm {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #host: HTMLElement;
	readonly #repository: ReaderTranslationConfigRepository;
	readonly #readTheme: () => ReaderTranslationTheme;
	readonly #persistTheme: (theme: ReaderTranslationTheme) => void;
	readonly #theme: HTMLSelectElement;
	readonly #themePreview: HTMLElement;
	readonly #animation: HTMLSelectElement;
	readonly #animationPreview: HTMLElement;
	readonly #animationPreviewOutput: HTMLElement;
	readonly #model: HTMLSelectElement;
	readonly #serviceIdentity: HTMLElement;
	readonly #serviceState: HTMLElement;
	readonly #prompt: HTMLTextAreaElement;
	readonly #temperature: HTMLInputElement;
	readonly #temperatureValue: HTMLOutputElement;
	readonly #reasoningEffort: HTMLSelectElement;
	readonly #customReasoningEffort: HTMLInputElement;
	readonly #requestsPerMinute: HTMLInputElement;
	readonly #tokensPerMinute: HTMLInputElement;
	readonly #save: HTMLButtonElement;
	readonly #status: HTMLElement;

	constructor(options: ReaderTranslationSettingsFormOptions) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#document = options.document;
		this.#host = options.host;
		this.#repository = options.repository;
		this.#readTheme = options.presentation?.readTheme ??
			(() => DEFAULT_READER_TRANSLATION_THEME);
		this.#persistTheme = options.presentation?.persistTheme ?? (() => {});
		const section = settingsSection(
			options.document,
			'翻译设置',
			'设置译文呈现，以及当前 AI 服务用于正文翻译的参数。',
			true,
		);

		this.#theme = element(
			options.document,
			'select',
			'ldp-reader-select ldp-boost-rule-control',
		);
		this.#theme.setAttribute('aria-label', '译文呈现样式');
		const themeLabels: Readonly<Record<ReaderTranslationTheme, string>> =
			Object.freeze({
				quote: '淡灰引用（默认）',
				plain: '自然正文',
				weakening: '弱化译文',
				'dividing-line': '分隔线',
				underline: '下划线',
				highlight: '柔和高亮',
				paper: '纸张卡片',
			});
		for (const theme of READER_TRANSLATION_THEMES) {
			this.#theme.append(settingsOption(
				options.document,
				theme,
				themeLabels[theme],
			));
		}
		const themePreview = translationSettingsPreview(options.document, 'theme');
		this.#themePreview = themePreview.root;
		section.append(settingsOptionRow(
			options.document,
			'译文样式',
			'选择译文的弱化、分隔或强调方式；切换后立即生效，仅影响双语模式。',
			previewControl(options.document, this.#theme, this.#themePreview),
		));

		this.#animation = element(
			options.document,
			'select',
			'ldp-reader-select ldp-boost-rule-control',
		);
		this.#animation.setAttribute('aria-label', '译文出现动画');
		const animationLabels: Readonly<Record<ReaderTranslationAnimation, string>> =
			Object.freeze({
				fade: '逐词浮现（推荐）',
				blur: '逐词聚焦',
				typewriter: '打字流式',
				shimmer: '流光波浪',
				spring: '弹性落字',
				none: '关闭动画',
			});
		for (const animation of READER_TRANSLATION_ANIMATIONS) {
			this.#animation.append(settingsOption(
				options.document,
				animation,
				animationLabels[animation],
			));
		}
		const animationPreview = translationSettingsPreview(
			options.document,
			'animation',
		);
		this.#animationPreview = animationPreview.root;
		this.#animationPreviewOutput = animationPreview.output;
		section.append(settingsOptionRow(
			options.document,
			'译文动画',
			'全局控制译文的出现方式；系统减少动态效果时自动关闭。',
			previewControl(
				options.document,
				this.#animation,
				this.#animationPreview,
			),
		));

		this.#model = element(
			options.document,
			'select',
			'ldp-reader-select ldp-boost-rule-control',
		);
		this.#model.dataset.readerSelectSearchable = 'true';
		this.#model.setAttribute('aria-label', '正文翻译模型');
		const modelRow = settingsOptionRow(
			options.document,
			'翻译模型',
			'公共翻译无需 API；自定义模型按供应商 URL 分组，来自“AI 服务”已缓存目录。',
			this.#model,
		);

		const profileGroup = element(
			options.document,
			'article',
			'ldp-translation-profile-group',
		);
		const profileHeading = element(
			options.document,
			'header',
			'ldp-translation-profile-heading',
		);
		const profileHeadingCopy = element(
			options.document,
			'span',
			'ldp-translation-group-copy',
		);
		const profileTitle = element(options.document, 'strong');
		profileTitle.textContent = '当前服务的翻译参数';
		this.#serviceIdentity = element(options.document, 'small');
		profileHeadingCopy.append(profileTitle, this.#serviceIdentity);
		this.#serviceState = element(
			options.document,
			'span',
			'ldp-translation-profile-state',
		);
		profileHeading.append(profileHeadingCopy, this.#serviceState);

		const advanced = element(
			options.document,
			'details',
			'ldp-translation-advanced',
		);
		const advancedSummary = element(
			options.document,
			'summary',
			'ldp-translation-advanced-summary',
		);
		const advancedCopy = element(
			options.document,
			'span',
			'ldp-translation-advanced-copy',
		);
		const advancedTitle = element(options.document, 'strong');
		advancedTitle.textContent = '高级设置';
		const advancedDescription = element(options.document, 'small');
		advancedDescription.textContent =
			'温度、思考等级、RPM / TPM 与翻译 Prompt';
		advancedCopy.append(advancedTitle, advancedDescription);
		advancedSummary.append(
			advancedCopy,
			settingsIcon(options.document, 'chevron-down'),
		);
		const advancedBody = element(
			options.document,
			'div',
			'ldp-translation-advanced-body',
		);

		this.#temperature = element(options.document, 'input');
		this.#temperature.type = 'range';
		this.#temperature.min = '0';
		this.#temperature.max = '1';
		this.#temperature.step = '0.1';
		this.#temperature.setAttribute('aria-label', '翻译温度');
		this.#temperatureValue = element(
			options.document,
			'output',
			'ldp-translation-temperature-value',
		);
		const temperatureControl = element(
			options.document,
			'span',
			'ldp-translation-temperature-control',
		);
		temperatureControl.append(this.#temperature, this.#temperatureValue);
		advancedBody.append(settingsOptionRow(
			options.document,
			'温度',
			'默认 0.1；翻译强调稳定与占位符完整，通常建议不超过 0.2。',
			temperatureControl,
		));

		this.#reasoningEffort = element(
			options.document,
			'select',
			'ldp-boost-rule-control',
		);
		this.#reasoningEffort.setAttribute('aria-label', '思考等级');
		for (const value of READER_AI_REASONING_EFFORT_PRESETS) {
			this.#reasoningEffort.append(settingsOption(
				options.document,
				value,
				reasoningEffortLabels.get(value) ?? value,
			));
		}
		this.#reasoningEffort.append(settingsOption(
			options.document,
			CUSTOM_REASONING_EFFORT,
			'自定义…',
		));
		this.#customReasoningEffort = field(
			options.document,
			'自定义思考等级',
			'text',
			'例如：turbo',
		);
		this.#customReasoningEffort.maxLength = 64;
		const reasoningControl = element(
			options.document,
			'span',
			'ldp-translation-reasoning-control',
		);
		reasoningControl.append(
			this.#reasoningEffort,
			this.#customReasoningEffort,
		);
		advancedBody.append(settingsOptionRow(
			options.document,
			'思考等级',
			'默认关闭；预设采用 OpenAI reasoning_effort 值，具体支持范围由所选模型决定。选择自定义时可填写兼容服务接受的值。',
			reasoningControl,
		));

		this.#requestsPerMinute = field(
			options.document,
			'每分钟请求数（RPM）',
			'number',
			'0',
		);
		this.#requestsPerMinute.min = '0';
		this.#requestsPerMinute.max = '10000';
		this.#requestsPerMinute.step = '1';
		this.#requestsPerMinute.inputMode = 'numeric';
		advancedBody.append(settingsOptionRow(
			options.document,
			'RPM',
			'当前 URL 与模型每分钟最多启动的 AI 请求数；0 表示不限制。预加载会为可见正文保留额度。',
			this.#requestsPerMinute,
		));

		this.#tokensPerMinute = field(
			options.document,
			'每分钟令牌数（TPM）',
			'number',
			'0',
		);
		this.#tokensPerMinute.min = '0';
		this.#tokensPerMinute.max = '100000000';
		this.#tokensPerMinute.step = '1';
		this.#tokensPerMinute.inputMode = 'numeric';
		advancedBody.append(settingsOptionRow(
			options.document,
			'TPM',
			'当前 URL 与模型每分钟允许的估算输入及译文令牌数；0 表示不限制。',
			this.#tokensPerMinute,
		));

		this.#prompt = element(
			options.document,
			'textarea',
			'ldp-boost-rule-control ldp-translation-prompt',
		);
		this.#prompt.rows = 4;
		this.#prompt.maxLength = 4000;
		this.#prompt.setAttribute('aria-label', '翻译 Prompt');
		advancedBody.append(settingsOptionRow(
			options.document,
			'翻译 Prompt',
			'控制术语、语气与译法；JSON 数组和占位符规则由阅读器固定维护。',
			this.#prompt,
		));

		this.#save = settingsButton(
			options.document,
			'ldp-config-action is-primary',
			'保存翻译设置',
			'check',
			'保存设置',
		);
		const footer = element(
			options.document,
			'div',
			'ldp-translation-footer',
		);
		const actions = element(
			options.document,
			'div',
			'ldp-webdav-actions ldp-translation-actions',
		);
		actions.append(this.#save);
		this.#status = element(
			options.document,
			'small',
			'ldp-webdav-status ldp-translation-status',
		);
		this.#status.role = 'status';
		this.#status.setAttribute('aria-live', 'polite');
		footer.append(this.#status, actions);
		advancedBody.append(footer);
		advanced.append(advancedSummary, advancedBody);
		profileGroup.append(profileHeading, modelRow, advanced);
		section.append(profileGroup);

		const root = element(
			options.document,
			'div',
			'ldp-settings-fields ldp-translation-settings',
		);
		root.append(section);
		this.#host.replaceChildren(root);
		this.scope.listen(this.#temperature, 'input', () => {
			this.#syncTemperature();
		});
		this.scope.listen(this.#reasoningEffort, 'change', () => {
			this.#syncReasoningEffort();
		});
		this.scope.listen(this.#theme, 'change', () => this.#applyTheme());
		this.scope.listen(this.#animation, 'change', () =>
			void this.#applyAnimation());
		this.scope.listen(this.#model, 'change', () => {
			this.#loadSelectedProfile(this.#repository.snapshot.config);
			this.#renderStatus('已切换翻译模型草稿，保存后生效。');
		});
		this.scope.listen(this.#save, 'click', () => void this.#saveConfig());
		this.#repository.changes.subscribe((snapshot) => {
			if (snapshot.loaded) this.#loadConfig(snapshot.config);
		}, this.scope);
		this.scope.add(() => this.#host.replaceChildren());
		void this.#load();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#applyTheme(): void {
		const theme = normalizeReaderTranslationTheme(selectedValue(this.#theme));
		this.#syncThemePreview(theme);
		try {
			this.#persistTheme(theme);
			this.#renderStatus('译文样式已更新；双语正文立即使用新样式。', 'success');
		} catch (cause) {
			const current = this.#readTheme();
			selectValue(this.#theme, current);
			this.#syncThemePreview(current);
			this.#renderStatus(cause instanceof Error
				? cause.message
				: '译文样式保存失败', 'error');
		}
	}

	async #applyAnimation(): Promise<void> {
		const current = this.#repository.snapshot.config;
		const animation = normalizeReaderTranslationAnimation(
			selectedValue(this.#animation),
		);
		this.#syncAnimationPreview(animation, true);
		try {
			await this.#repository.saveConfig(normalizeReaderTranslationConfig({
				...current,
				animation,
			}));
			this.#renderStatus('译文动画已更新；所有翻译统一使用新动画。', 'success');
		} catch (cause) {
			selectValue(this.#animation, current.animation);
			this.#syncAnimationPreview(current.animation, true);
			this.#renderStatus(cause instanceof Error
				? cause.message
				: '译文动画保存失败', 'error');
		}
	}

	#syncThemePreview(theme: ReaderTranslationTheme): void {
		this.#themePreview.dataset.translationTheme = theme;
	}

	#syncAnimationPreview(
		animation: ReaderTranslationAnimation,
		forceReplay = false,
	): void {
		if (
			!forceReplay &&
			this.#animationPreview.dataset.translationAnimation === animation
		) return;
		this.#animationPreview.dataset.translationTheme = 'plain';
		delete this.#animationPreview.dataset.translationAnimation;
		this.#animationPreviewOutput.classList.remove(
			'ldp-translation-enter',
			'ldp-translation-segmented',
		);
		renderAnimationPreviewText(
			this.#document,
			this.#animationPreviewOutput,
		);
		void this.#animationPreview.offsetWidth;
		this.#animationPreview.dataset.translationAnimation = animation;
		this.#animationPreviewOutput.classList.toggle(
			'ldp-translation-segmented',
			SEGMENTED_TRANSLATION_ANIMATIONS.has(animation),
		);
		if (animation === 'none') return;
		this.#animationPreviewOutput.classList.add('ldp-translation-enter');
	}

	#draft(
		active: ReaderTranslationProfile,
		model: string,
	): ReaderTranslationProfile {
		const reasoningSelection = selectedValue(this.#reasoningEffort);
		return {
			...active,
			model,
			prompt: this.#prompt.value.trim(),
			temperature: Number(this.#temperature.value),
			reasoningEffort: reasoningSelection === CUSTOM_REASONING_EFFORT
				? this.#customReasoningEffort.value.trim()
				: reasoningSelection,
			requestsPerMinute: Number(this.#requestsPerMinute.value),
			tokensPerMinute: Number(this.#tokensPerMinute.value),
			animation: this.#repository.snapshot.config.animation,
		};
	}

	#syncTemperature(): void {
		const value = Number(this.#temperature.value);
		this.#temperatureValue.textContent = value.toFixed(1);
		this.#temperature.style.setProperty(
			'--ldp-range-progress',
			`${value * 100}%`,
		);
	}

	#loadReasoningEffort(value: string): void {
		const preset = READER_AI_REASONING_EFFORT_PRESETS.includes(
			value as (typeof READER_AI_REASONING_EFFORT_PRESETS)[number],
		);
		selectValue(
			this.#reasoningEffort,
			preset ? value : CUSTOM_REASONING_EFFORT,
		);
		this.#customReasoningEffort.value = preset ? '' : value;
		this.#syncReasoningEffort();
	}

	#syncReasoningEffort(): void {
		const custom = selectedValue(this.#reasoningEffort) ===
			CUSTOM_REASONING_EFFORT;
		this.#customReasoningEffort.hidden = !custom;
		this.#customReasoningEffort.disabled = !custom;
	}

	#renderModelOptions(config: ReaderTranslationConfig): void {
		const publicOption = settingsOption(
			this.#document,
			PUBLIC_TRANSLATION_MODEL,
			'Google / Microsoft 公共翻译',
		);
		const groups = config.profiles
			.filter((profile) => profile.apiKey.trim() && profile.models.length)
			.map((profile) => {
				const group = this.#document.createElement('optgroup');
				group.label = profile.baseUrl.replace(/\/$/u, '');
				group.append(...[...profile.modelCatalog]
					.sort(compareReaderAiModels)
					.map((entry) => settingsOption(
					this.#document,
					modelSelectionValue(profile.baseUrl, entry.id),
					readerAiModelDisplayLabel(entry),
				)));
				return group;
			});
		this.#model.replaceChildren(publicOption, ...groups);
		const active = readerTranslationActiveProfile(config);
		const selected = active.apiKey.trim() && active.models.includes(active.model)
			? modelSelectionValue(active.baseUrl, active.model)
			: PUBLIC_TRANSLATION_MODEL;
		selectValue(this.#model, selected);
	}

	#selectedProfile(config: ReaderTranslationConfig): ReaderTranslationProfile {
		const selection = parseModelSelection(selectedValue(this.#model));
		return selection
			? config.profiles.find((profile) =>
				profile.baseUrl === selection.baseUrl &&
				profile.models.includes(selection.model)) ??
				readerTranslationActiveProfile(config)
			: readerTranslationActiveProfile(config);
	}

	#loadSelectedProfile(config: ReaderTranslationConfig): void {
		const selection = parseModelSelection(selectedValue(this.#model));
		const active = this.#selectedProfile(config);
		this.#serviceIdentity.textContent = selection
			? `${active.baseUrl.replace(/\/$/u, '')} · ${selection.model}`
			: 'Google / Microsoft 公共翻译';
		this.#serviceState.textContent = selection ? 'AI 翻译' : '公共翻译';
		this.#serviceState.dataset.profileState = selection ? 'ready' : 'inactive';
		this.#prompt.value = active.prompt;
		this.#temperature.value = String(active.temperature);
		this.#syncTemperature();
		this.#loadReasoningEffort(active.reasoningEffort);
		this.#requestsPerMinute.value = String(active.requestsPerMinute);
		this.#tokensPerMinute.value = String(active.tokensPerMinute);
	}

	#loadConfig(config: ReaderTranslationConfig): void {
		selectValue(this.#animation, config.animation);
		this.#syncAnimationPreview(config.animation);
		this.#renderModelOptions(config);
		this.#loadSelectedProfile(config);
	}

	async #load(): Promise<void> {
		try {
			const theme = this.#readTheme();
			selectValue(this.#theme, theme);
			this.#syncThemePreview(theme);
			const { config } = await this.#repository.load();
			if (this.scope.destroyed) return;
			this.#loadConfig(config);
			this.#renderStatus('供应商目录在“AI 服务”管理；正文翻译模型在此单独选择。');
		} catch (cause) {
			this.#renderStatus(cause instanceof Error
				? cause.message
				: '翻译设置读取失败', 'error');
		}
	}

	async #saveConfig(): Promise<boolean> {
		if (
			selectedValue(this.#reasoningEffort) === CUSTOM_REASONING_EFFORT &&
			!this.#customReasoningEffort.value.trim()
		) {
			this.#renderStatus('请填写自定义思考等级。', 'error');
			return false;
		}
		const current = this.#repository.snapshot.config;
		const selection = parseModelSelection(selectedValue(this.#model));
		const active = this.#selectedProfile(current);
		const profile = this.#draft(active, selection?.model ?? '');
		const issues = validateReaderTranslationProfile(profile);
		if (issues.length) {
			this.#renderStatus(issues[0]!, 'error');
			return false;
		}
		try {
			const config = normalizeReaderTranslationConfig({
				...current,
				activeBaseUrl: selection?.baseUrl ?? current.activeBaseUrl,
				profiles: current.profiles.map((entry) =>
					entry.baseUrl === active.baseUrl ? profile : entry),
			});
			await this.#repository.saveConfig(config);
			this.#renderStatus(selection
				? `已保存正文翻译模型：${selection.model}`
				: '已切换为 Google / Microsoft 公共翻译。', 'success');
			return true;
		} catch (cause) {
			this.#renderStatus(cause instanceof Error
				? cause.message
				: '翻译设置保存失败', 'error');
			return false;
		}
	}

	#renderStatus(
		message: string,
		kind: 'idle' | 'error' | 'success' = 'idle',
	): void {
		this.#status.textContent = message;
		if (kind === 'idle') this.#status.removeAttribute('data-status-kind');
		else this.#status.dataset.statusKind = kind;
	}
}
