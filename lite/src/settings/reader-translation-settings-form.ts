import { LifecycleScope } from '../kernel/lifecycle.js';
import type { TranslationRequestAdapter } from
	'../translation/translation-request-adapter.js';
import {
	READER_AI_REASONING_EFFORT_PRESETS,
	READER_TRANSLATION_ANIMATIONS,
	createReaderTranslationDefaultProfile,
	normalizeReaderTranslationBaseUrl,
	normalizeReaderTranslationConfig,
	readerTranslationActiveProfile,
	readerTranslationUsesAi,
	validateReaderTranslationAccessConfig,
	validateReaderTranslationProfile,
	type ReaderTranslationAccessConfig,
	type ReaderTranslationConfig,
	type ReaderTranslationConfigRepository,
	type ReaderTranslationProfile,
} from '../translation/reader-translation-config.js';
import {
	settingsButton,
	settingsElement as element,
	settingsIcon,
	settingsOption,
	settingsOptionRow,
	settingsSection,
} from './reader-settings-dom.js';

const CUSTOM_REASONING_EFFORT = '__custom__';

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
	readonly access: Pick<TranslationRequestAdapter, 'listModels'>;
	readonly parentScope?: LifecycleScope;
}

function field(
	document: Document,
	label: string,
	type: 'text' | 'password' | 'number',
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
		const selected = option.value === value;
		option.toggleAttribute('selected', selected);
	}
}

function selectedValue(select: HTMLSelectElement): string {
	return [...select.options].filter((option) => option.selected).at(-1)?.value ??
		[...select.options].filter((option) =>
			option.hasAttribute('selected')).at(-1)?.value ?? '';
}

/** 连接信息、服务端模型目录与折叠高级参数的唯一翻译设置 DOM owner。 */
export class ReaderTranslationSettingsForm {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #host: HTMLElement;
	readonly #repository: ReaderTranslationConfigRepository;
	readonly #access: Pick<TranslationRequestAdapter, 'listModels'>;
	readonly #profile: HTMLSelectElement;
	readonly #addProfile: HTMLButtonElement;
	readonly #removeProfile: HTMLButtonElement;
	readonly #profileCount: HTMLElement;
	readonly #profileIdentity: HTMLElement;
	readonly #profileState: HTMLElement;
	readonly #baseUrl: HTMLInputElement;
	readonly #apiKey: HTMLInputElement;
	readonly #model: HTMLSelectElement;
	readonly #prompt: HTMLTextAreaElement;
	readonly #temperature: HTMLInputElement;
	readonly #temperatureValue: HTMLOutputElement;
	readonly #reasoningEffort: HTMLSelectElement;
	readonly #customReasoningEffort: HTMLInputElement;
	readonly #requestsPerMinute: HTMLInputElement;
	readonly #tokensPerMinute: HTMLInputElement;
	readonly #animation: HTMLSelectElement;
	readonly #save: HTMLButtonElement;
	readonly #loadModels: HTMLButtonElement;
	readonly #status: HTMLElement;
	#catalogIdentity: string | null = null;
	#editingBaseUrl: string | null = null;
	#operation: AbortController | null = null;

	constructor(options: ReaderTranslationSettingsFormOptions) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#document = options.document;
		this.#host = options.host;
		this.#repository = options.repository;
		this.#access = options.access;
		const section = settingsSection(
			options.document,
			'OpenAI 兼容 API 集合',
			'每个 URL 独立保存 Key、模型与翻译参数；Key 留空时继续使用 Google / Microsoft。',
			true,
		);
		this.#profile = element(
			options.document,
			'select',
			'ldp-reader-select ldp-boost-rule-control',
		);
		this.#profile.setAttribute('aria-label', '当前翻译服务');
		this.#addProfile = settingsButton(
			options.document,
			'ldp-config-action',
			'新增翻译 URL',
			'plus',
			'新增 URL',
		);
		this.#removeProfile = settingsButton(
			options.document,
			'ldp-config-action',
			'删除当前翻译 URL',
			'trash',
			'删除',
		);
		const profileControl = element(
			options.document,
			'span',
			'ldp-translation-profile-control',
		);
		profileControl.append(
			this.#profile,
			this.#addProfile,
			this.#removeProfile,
		);
		const collectionGroup = element(
			options.document,
			'div',
			'ldp-translation-collection-group',
		);
		const collectionHeading = element(
			options.document,
			'div',
			'ldp-translation-group-heading',
		);
		const collectionCopy = element(
			options.document,
			'span',
			'ldp-translation-group-copy',
		);
		const collectionTitle = element(options.document, 'strong');
		collectionTitle.textContent = '服务集合';
		const collectionDescription = element(options.document, 'small');
		collectionDescription.textContent =
			'AI 为可选增强；未配置时默认使用 Google / Microsoft 公共翻译';
		collectionCopy.append(collectionTitle, collectionDescription);
		this.#profileCount = element(
			options.document,
			'span',
			'ldp-translation-profile-count',
		);
		collectionHeading.append(collectionCopy, this.#profileCount);
		collectionGroup.append(collectionHeading, settingsOptionRow(
			options.document,
			'当前服务',
			'选择要查看或编辑的 URL；重复 URL 会更新原服务项。',
			profileControl,
		));
		section.append(collectionGroup);

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
		profileTitle.textContent = '服务配置';
		this.#profileIdentity = element(options.document, 'small');
		profileHeadingCopy.append(profileTitle, this.#profileIdentity);
		this.#profileState = element(
			options.document,
			'span',
			'ldp-translation-profile-state',
		);
		profileHeading.append(profileHeadingCopy, this.#profileState);
		const profileFields = element(
			options.document,
			'div',
			'ldp-translation-profile-fields',
		);
		profileGroup.append(profileHeading, profileFields);
		section.append(profileGroup);
		this.#baseUrl = field(
			options.document,
			'API URL',
			'text',
			'https://api.openai.com/v1/',
		);
		this.#baseUrl.inputMode = 'url';
		profileFields.append(settingsOptionRow(
			options.document,
			'API URL',
			'填写 OpenAI 兼容服务的 /v1 根地址；末尾斜杠会自动补齐。',
			this.#baseUrl,
		));
		this.#apiKey = field(
			options.document,
			'API Key',
			'password',
			'sk-…',
		);
		this.#apiKey.autocomplete = 'new-password';
		profileFields.append(settingsOptionRow(
			options.document,
			'API Key',
			'与当前 URL 一一对应；留空仍使用 Google / Microsoft 公共翻译，WebDAV 同步时仅此字段加密。',
			this.#apiKey,
		));

		this.#model = element(
			options.document,
			'select',
			'ldp-reader-select ldp-boost-rule-control',
		);
		this.#model.setAttribute('aria-label', '模型');
		this.#loadModels = settingsButton(
			options.document,
			'ldp-config-action ldp-translation-model-fetch',
			'从 /models 获取可用模型',
			'list',
			'获取模型',
		);
		const modelControl = element(
			options.document,
			'span',
			'ldp-translation-model-control',
		);
		modelControl.append(this.#model, this.#loadModels);
		profileFields.append(settingsOptionRow(
			options.document,
			'模型',
			'由当前 URL 的 /models 返回，不提供预设或手动输入。',
			modelControl,
		));
		this.#replaceModelOptions([], '');
		this.#animation = element(
			options.document,
			'select',
			'ldp-reader-select ldp-boost-rule-control',
		);
		this.#animation.setAttribute('aria-label', '译文出现动画');
		const animationLabels = Object.freeze({
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
		profileFields.append(settingsOptionRow(
			options.document,
			'译文动画',
			'控制每个 Section 完成翻译后的逐词或整段出现方式；系统减少动态效果时自动关闭。',
			this.#animation,
		));

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
		this.#temperature = element(
			options.document,
			'input',
		);
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
		advanced.append(advancedSummary, advancedBody);
		profileFields.append(advanced);

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
		footer.append(actions, this.#status);
		profileFields.append(footer);

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
		this.scope.listen(this.#baseUrl, 'change', () => this.#invalidateModels());
		this.scope.listen(this.#apiKey, 'change', () => this.#invalidateModels());
		this.scope.listen(this.#baseUrl, 'input', () => this.#syncProfileSummary());
		this.scope.listen(this.#apiKey, 'input', () => this.#syncProfileSummary());
		this.scope.listen(this.#model, 'change', () => this.#syncProfileSummary());
		this.scope.listen(this.#profile, 'change', () => this.#selectProfile());
		this.scope.listen(this.#addProfile, 'click', () => this.#startNewProfile());
		this.scope.listen(this.#removeProfile, 'click', () =>
			void this.#removeCurrentProfile());
		this.scope.listen(this.#save, 'click', () => void this.#saveConfig());
		this.scope.listen(this.#loadModels, 'click', () => void this.#fetchModels());
		this.scope.add(() => {
			this.#operation?.abort(new Error('翻译设置已关闭'));
			this.#host.replaceChildren();
		});
		void this.#load();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#accessDraft(): ReaderTranslationAccessConfig {
		return {
			baseUrl: this.#baseUrl.value.trim(),
			apiKey: this.#apiKey.value.trim(),
		};
	}

	#draft(): ReaderTranslationProfile {
		const reasoningSelection = selectedValue(this.#reasoningEffort);
		return {
			...this.#accessDraft(),
			model: selectedValue(this.#model).trim(),
			prompt: this.#prompt.value.trim(),
			temperature: Number(this.#temperature.value),
			reasoningEffort: reasoningSelection === CUSTOM_REASONING_EFFORT
				? this.#customReasoningEffort.value.trim()
				: reasoningSelection,
			requestsPerMinute: Number(this.#requestsPerMinute.value),
			tokensPerMinute: Number(this.#tokensPerMinute.value),
			animation: selectedValue(this.#animation) as
				ReaderTranslationProfile['animation'],
		};
	}

	#identity(config: ReaderTranslationAccessConfig = this.#accessDraft()): string {
		return `${normalizeReaderTranslationBaseUrl(config.baseUrl)}\u0000${config.apiKey}`;
	}

	#replaceModelOptions(
		models: readonly string[],
		preferred: string,
	): void {
		const uniqueModels = [...new Set(models.map((model) => model.trim()).filter(Boolean))];
		const placeholder = settingsOption(
			this.#document,
			'',
			uniqueModels.length ? '请选择模型' : '请先获取模型',
		);
		placeholder.disabled = true;
		this.#model.replaceChildren(
			placeholder,
			...uniqueModels.map((model) => settingsOption(this.#document, model, model)),
		);
		selectValue(this.#model, uniqueModels.includes(preferred) ? preferred : '');
		this.#model.disabled = uniqueModels.length === 0;
	}

	#invalidateModels(): void {
		if (this.#catalogIdentity === this.#identity()) return;
		this.#catalogIdentity = null;
		this.#replaceModelOptions([], '');
		this.#syncProfileSummary();
		this.#renderStatus('连接信息已变化，请重新获取模型。');
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

	#syncProfileSummary(): void {
		const normalizedUrl = normalizeReaderTranslationBaseUrl(this.#baseUrl.value);
		this.#profileIdentity.textContent = normalizedUrl
			? normalizedUrl.replace(/\/$/u, '')
			: this.#baseUrl.value.trim() || '尚未填写 URL';
		let state = '公共翻译';
		let kind = 'public';
		if (this.#editingBaseUrl === null) {
			state = '新建草稿';
			kind = 'draft';
		} else if (this.#apiKey.value.trim() && selectedValue(this.#model)) {
			state = 'AI 已配置';
			kind = 'ready';
		} else if (this.#apiKey.value.trim()) {
			state = '待选模型';
			kind = 'pending';
		}
		this.#profileState.textContent = state;
		this.#profileState.dataset.profileState = kind;
	}

	#renderProfileOptions(config: ReaderTranslationConfig): void {
		this.#profile.replaceChildren(...config.profiles.map((profile) =>
			settingsOption(
				this.#document,
				profile.baseUrl,
				profile.baseUrl.replace(/\/$/u, ''),
			)));
		selectValue(this.#profile, config.activeBaseUrl);
		this.#profileCount.textContent = `${config.profiles.length} 个已保存服务`;
	}

	#loadProfile(profile: ReaderTranslationProfile): void {
		this.#editingBaseUrl = normalizeReaderTranslationBaseUrl(profile.baseUrl) || null;
		this.#baseUrl.value = profile.baseUrl;
		this.#apiKey.value = profile.apiKey;
		this.#prompt.value = profile.prompt;
		this.#temperature.value = String(profile.temperature);
		this.#syncTemperature();
		this.#loadReasoningEffort(profile.reasoningEffort);
		this.#requestsPerMinute.value = String(profile.requestsPerMinute);
		this.#tokensPerMinute.value = String(profile.tokensPerMinute);
		selectValue(this.#animation, profile.animation);
		this.#replaceModelOptions(
			profile.model ? [profile.model] : [],
			profile.model,
		);
		this.#catalogIdentity = profile.model ? this.#identity(profile) : null;
		this.#syncProfileSummary();
	}

	#selectProfile(): void {
		const url = selectedValue(this.#profile);
		const profile = this.#repository.snapshot.config.profiles.find((entry) =>
			entry.baseUrl === url);
		if (!profile) return;
		this.#loadProfile(profile);
		this.#renderStatus(profile.apiKey && profile.model
			? `当前服务：${profile.model}`
			: '当前 URL 尚未启用 AI；Key 留空时使用公共翻译。');
	}

	#startNewProfile(): void {
		const draft = createReaderTranslationDefaultProfile();
		this.#editingBaseUrl = null;
		this.#profile.replaceChildren(
			...this.#repository.snapshot.config.profiles.map((profile) =>
				settingsOption(
					this.#document,
					profile.baseUrl,
					profile.baseUrl.replace(/\/$/u, ''),
				)),
			settingsOption(this.#document, '__new__', '新建 URL（未保存）'),
		);
		selectValue(this.#profile, '__new__');
		this.#baseUrl.value = '';
		this.#apiKey.value = '';
		this.#prompt.value = draft.prompt;
		this.#temperature.value = String(draft.temperature);
		this.#syncTemperature();
		this.#loadReasoningEffort(draft.reasoningEffort);
		this.#requestsPerMinute.value = String(draft.requestsPerMinute);
		this.#tokensPerMinute.value = String(draft.tokensPerMinute);
		selectValue(this.#animation, draft.animation);
		this.#replaceModelOptions([], '');
		this.#catalogIdentity = null;
		this.#syncProfileSummary();
		this.#renderStatus('填写新 URL 与 Key，从 /models 获取模型后保存。');
	}

	async #removeCurrentProfile(): Promise<void> {
		if (!this.#editingBaseUrl) {
			const current = this.#repository.snapshot.config;
			this.#renderProfileOptions(current);
			this.#loadProfile(readerTranslationActiveProfile(current));
			this.#renderStatus('已放弃未保存的新 URL。');
			return;
		}
		const current = this.#repository.snapshot.config;
		const profiles = current.profiles.filter((profile) =>
			profile.baseUrl !== this.#editingBaseUrl);
		const next = normalizeReaderTranslationConfig({
			profiles,
			activeBaseUrl: profiles[0]?.baseUrl,
		});
		try {
			await this.#repository.saveConfig(next);
			this.#renderProfileOptions(next);
			this.#loadProfile(readerTranslationActiveProfile(next));
			this.#renderStatus(profiles.length
				? '已删除当前 URL，并切换到下一项。'
				: '已删除最后一项；保留空白 OpenAI 默认入口供后续配置。', 'success');
		} catch (cause) {
			this.#renderStatus(cause instanceof Error
				? cause.message
				: '删除翻译 URL 失败', 'error');
		}
	}

	async #load(): Promise<void> {
		try {
			const { config } = await this.#repository.load();
			if (this.scope.destroyed) return;
			this.#renderProfileOptions(config);
			const active = readerTranslationActiveProfile(config);
			this.#loadProfile(active);
			this.#renderStatus(readerTranslationUsesAi(config)
				? `AI 翻译已启用：${active.model}`
				: '当前使用 Google / Microsoft；填写 Key 后获取并选择模型。');
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
		const profile = this.#draft();
		const issues = validateReaderTranslationProfile(profile);
		if (issues.length) {
			this.#renderStatus(issues[0]!, 'error');
			return false;
		}
		try {
			const current = this.#repository.snapshot.config;
			const baseUrl = normalizeReaderTranslationBaseUrl(profile.baseUrl);
			const profiles = current.profiles.filter((entry) =>
				entry.baseUrl !== this.#editingBaseUrl && entry.baseUrl !== baseUrl);
			profiles.push(Object.freeze({ ...profile, baseUrl }));
			const config = normalizeReaderTranslationConfig({
				profiles,
				activeBaseUrl: baseUrl,
			});
			await this.#repository.saveConfig(config);
			this.#renderProfileOptions(config);
			const active = readerTranslationActiveProfile(config);
			this.#loadProfile(active);
			this.#renderStatus(readerTranslationUsesAi(config)
				? `已保存；后续翻译与预加载使用 ${active.model}。`
				: '已保存；API Key 为空，后续使用公共翻译。', 'success');
			return true;
		} catch (cause) {
			this.#renderStatus(cause instanceof Error
				? cause.message
				: '翻译设置保存失败', 'error');
			return false;
		}
	}

	async #fetchModels(): Promise<void> {
		if (this.#operation) return;
		const access = this.#accessDraft();
		const issues = validateReaderTranslationAccessConfig(access);
		if (issues.length) {
			this.#renderStatus(issues[0]!, 'error');
			return;
		}
		const operation = new AbortController();
		this.#operation = operation;
		this.#setBusy(true);
		this.#renderStatus('正在从 /models 获取可用模型…');
		try {
			const result = await this.#access.listModels(access, operation.signal);
			const saved = readerTranslationActiveProfile(
				this.#repository.snapshot.config,
			);
			const preferred = this.#identity(saved) === this.#identity(access)
				? saved.model
				: '';
			this.#replaceModelOptions(result.models, preferred);
			this.#catalogIdentity = this.#identity(access);
			this.#renderStatus(
				`已获取 ${result.models.length} 个模型，请选择后保存。`,
				'success',
			);
		} catch (cause) {
			if (!operation.signal.aborted) {
				this.#renderStatus(cause instanceof Error
					? cause.message
					: '模型列表获取失败', 'error');
			}
		} finally {
			if (this.#operation === operation) this.#operation = null;
			this.#setBusy(false);
		}
	}

	#setBusy(busy: boolean): void {
		this.#save.disabled = busy;
		this.#loadModels.disabled = busy;
		this.#profile.disabled = busy;
		this.#addProfile.disabled = busy;
		this.#removeProfile.disabled = busy;
		this.#baseUrl.disabled = busy;
		this.#apiKey.disabled = busy;
		this.#model.disabled = busy || this.#model.options.length <= 1;
		this.#prompt.disabled = busy;
		this.#temperature.disabled = busy;
		this.#reasoningEffort.disabled = busy;
		this.#animation.disabled = busy;
		this.#customReasoningEffort.disabled = busy ||
			this.#customReasoningEffort.hasAttribute('hidden');
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
