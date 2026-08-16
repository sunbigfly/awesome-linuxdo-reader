import { LifecycleScope } from '../kernel/lifecycle.js';
import { ReaderHeaderPopoverPosition } from
	'../collection/reader-header-popover-position.js';
import { READER_SELECT_RESELECT_EVENT } from
	'../shell/reader-select-surface.js';
import type { TranslationRequestAdapter } from
	'../translation/translation-request-adapter.js';
import {
	READER_AI_MODEL_METADATA_CACHE_MAX_AGE_MS,
	createReaderTranslationDefaultProfile,
	findReaderAiModelCatalogExactMatch,
	mergeReaderAiModelCatalogEntries,
	normalizeReaderTranslationBaseUrl,
	normalizeReaderTranslationConfig,
	readerAiModelKindGroups,
	readerAiModelIdentityLabel,
	readerTranslationActiveProfile,
	validateReaderTranslationAccessConfig,
	validateReaderTranslationProfile,
	type ReaderTranslationAccessConfig,
	type ReaderAiModelCatalogEntry,
	type ReaderTranslationConfig,
	type ReaderTranslationConfigRepository,
	type ReaderTranslationProfile,
} from '../translation/reader-translation-config.js';
import {
	settingsButton,
	settingsElement as element,
	settingsOption,
	settingsOptionRow,
	settingsSection,
} from './reader-settings-dom.js';

export interface ReaderAiServiceSettingsFormOptions {
	readonly document: Document;
	readonly host: HTMLElement;
	readonly surfaceHost?: HTMLElement;
	readonly repository: ReaderTranslationConfigRepository;
	readonly access: Pick<TranslationRequestAdapter, 'listModels' | 'listPublicModels'>;
	readonly parentScope?: LifecycleScope;
}

function field(
	document: Document,
	label: string,
	type: 'text' | 'password',
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

function compactTokenCount(value: number): string {
	if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
	if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`;
	return String(value);
}

function modelCreatedAtLabel(value: number): string {
	if (!value) return '';
	const date = new Date(value * 1_000);
	return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function metadataSourceLabel(value: string): string {
	if (value === 'models.dev') return 'Models.dev';
	if (value === 'openrouter') return 'OpenRouter';
	if (value === 'provider') return '当前供应商';
	return value;
}

function pricePerMillionLabel(value: string): string {
	const price = Number(value);
	if (!Number.isFinite(price) || price < 0) return '';
	return `$${Number((price * 1_000_000).toPrecision(8))}/百万 Token`;
}

function capabilityLabel(value: boolean | null): string {
	return value === true ? '支持' : value === false ? '不支持' : '';
}

/** 可供翻译、帖子总结等能力共用的 OpenAI 兼容服务设置 DOM owner。 */
export class ReaderAiServiceSettingsForm {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #host: HTMLElement;
	readonly #surfaceHost: HTMLElement;
	readonly #repository: ReaderTranslationConfigRepository;
	readonly #access: Pick<TranslationRequestAdapter, 'listModels' | 'listPublicModels'>;
	readonly #profile: HTMLSelectElement;
	readonly #addProfile: HTMLButtonElement;
	readonly #removeProfile: HTMLButtonElement;
	readonly #profileCount: HTMLElement;
	readonly #profileIdentity: HTMLElement;
	readonly #profileState: HTMLElement;
	readonly #baseUrl: HTMLInputElement;
	readonly #apiKey: HTMLInputElement;
	readonly #models: HTMLSelectElement;
	readonly #publicModels: HTMLSelectElement;
	readonly #publicExplorer: HTMLElement;
	readonly #publicExplorerToggle: HTMLButtonElement;
	readonly #publicRefresh: HTMLButtonElement;
	readonly #publicExplorerStatus: HTMLElement;
	readonly #modelMetadata: HTMLElement;
	readonly #modelMetadataClose: HTMLButtonElement;
	readonly #modelMetadataPosition: ReaderHeaderPopoverPosition;
	readonly #publicModelMetadataPosition: ReaderHeaderPopoverPosition;
	readonly #save: HTMLButtonElement;
	readonly #loadModels: HTMLButtonElement;
	readonly #status: HTMLElement;
	#catalog: readonly ReaderAiModelCatalogEntry[] = Object.freeze([]);
	#publicCatalog: readonly ReaderAiModelCatalogEntry[] = Object.freeze([]);
	#publicCatalogFetchedAt = 0;
	#publicCacheLoaded = false;
	#publicCacheLoadPromise: Promise<void> | null = null;
	#catalogIdentity: string | null = null;
	#editingBaseUrl: string | null = null;
	#operation: AbortController | null = null;
	#publicOperation: AbortController | null = null;
	#metadataAnchor: HTMLSelectElement | null = null;

	constructor(options: ReaderAiServiceSettingsFormOptions) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#document = options.document;
		this.#host = options.host;
		this.#surfaceHost = options.surfaceHost ?? options.host;
		this.#repository = options.repository;
		this.#access = options.access;
		const section = settingsSection(
			options.document,
			'AI 服务',
			'管理供翻译、帖子总结等功能共用的 OpenAI 兼容服务。',
			true,
		);

		this.#profile = element(
			options.document,
			'select',
			'ldp-reader-select ldp-boost-rule-control',
		);
		this.#profile.setAttribute('aria-label', '已保存 AI 服务');
		this.#addProfile = settingsButton(
			options.document,
			'ldp-config-action',
			'新增 AI 服务',
			'plus',
			'新增服务',
		);
		this.#removeProfile = settingsButton(
			options.document,
			'ldp-config-action',
			'删除当前 AI 服务',
			'trash',
			'删除服务',
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
		collectionTitle.textContent = '已保存服务';
		const collectionDescription = element(options.document, 'small');
		collectionDescription.textContent =
			'选择要编辑的供应商；各业务会单独选择供应商与模型';
		collectionCopy.append(collectionTitle, collectionDescription);
		this.#profileCount = element(
			options.document,
			'span',
			'ldp-translation-profile-count',
		);
		collectionHeading.append(collectionCopy, this.#profileCount);
		collectionGroup.append(collectionHeading, settingsOptionRow(
			options.document,
			'选择服务',
			'这里只管理连接与模型目录，不会替翻译或帖子总结限定模型。',
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
			'与当前 URL 一一对应；WebDAV 同步时仅此字段加密。留空时正文翻译仍可使用 Google / Microsoft 公共服务。',
			this.#apiKey,
		));

		this.#models = element(
			options.document,
			'select',
			'ldp-reader-select ldp-boost-rule-control ldp-ai-service-model-catalog',
		);
		this.#models.dataset.readerSelectSearchable = 'true';
		this.#models.dataset.readerSelectSearchLabel = '搜索模型';
		this.#models.dataset.readerSelectEmptyLabel = '没有匹配的模型';
		this.#models.setAttribute('aria-label', '已缓存的可用模型目录');
		this.#loadModels = settingsButton(
			options.document,
			'ldp-config-action ldp-translation-model-fetch',
			'从 /models 获取可用模型',
			'list',
			'获取模型',
		);
		this.#publicExplorerToggle = settingsButton(
			options.document,
			'ldp-config-action ldp-ai-model-explorer-toggle',
			'查询公共模型能力',
			'search',
		);
		this.#publicExplorerToggle.setAttribute('aria-expanded', 'false');
		this.#publicExplorerToggle.setAttribute(
			'aria-controls',
			'ldp-ai-model-public-explorer',
		);
		const modelControl = element(
			options.document,
			'span',
			'ldp-translation-model-control',
		);
		this.#modelMetadata = element(
			options.document,
			'article',
			'ldp-ai-service-model-metadata',
		);
		this.#modelMetadata.hidden = true;
		this.#modelMetadata.role = 'dialog';
		this.#modelMetadata.setAttribute('aria-live', 'polite');
		this.#modelMetadata.setAttribute('aria-label', '所选模型元数据与能力');
		this.#modelMetadataClose = element(
			options.document,
			'button',
			'ldp-ai-service-model-metadata-close',
		);
		this.#modelMetadataClose.type = 'button';
		this.#modelMetadataClose.textContent = '关闭';
		this.#modelMetadataClose.setAttribute('aria-label', '关闭模型详情');
		modelControl.append(
			this.#models,
			this.#loadModels,
			this.#publicExplorerToggle,
		);
		profileFields.append(settingsOptionRow(
			options.document,
			'可用模型目录',
			'优先使用 /models 返回的模态、上下文与基准元数据分组排序；缺失时按名称降级推断，不代表跨供应商官方排名。',
			modelControl,
		));
		this.#replaceModelCatalog([]);

		this.#publicModels = element(
			options.document,
			'select',
			'ldp-reader-select ldp-boost-rule-control ldp-ai-model-public-catalog',
		);
		this.#publicModels.dataset.readerSelectSearchable = 'true';
		this.#publicModels.dataset.readerSelectSearchLabel = '搜索公共模型';
		this.#publicModels.dataset.readerSelectEmptyLabel = '没有匹配的公共模型';
		this.#publicModels.setAttribute('aria-label', '公共模型能力目录');
		this.#publicExplorerStatus = element(
			options.document,
			'small',
			'ldp-ai-model-public-explorer-status',
		);
		this.#publicExplorerStatus.role = 'status';
		this.#publicExplorer = element(
			options.document,
			'div',
			'ldp-ai-model-public-explorer',
		);
		this.#publicExplorer.id = 'ldp-ai-model-public-explorer';
		this.#publicExplorer.hidden = true;
		const explorerHeading = element(
			options.document,
			'span',
			'ldp-ai-model-public-explorer-heading',
		);
		const explorerCopy = element(options.document, 'span');
		const explorerTitle = element(options.document, 'strong');
		explorerTitle.textContent = '公共模型能力查询';
		const explorerDescription = element(options.document, 'small');
		explorerDescription.textContent =
			'无需 API Key；精确目录来自 Models.dev 与 OpenRouter。';
		explorerCopy.append(explorerTitle, explorerDescription);
		this.#publicRefresh = settingsButton(
			options.document,
			'ldp-config-action ldp-ai-model-metadata-refresh',
			'强制刷新公共模型元数据',
			'rotate-ccw',
		);
		explorerHeading.append(explorerCopy, this.#publicRefresh);
		this.#publicExplorer.append(
			explorerHeading,
			this.#publicModels,
			this.#publicExplorerStatus,
		);
		profileFields.append(this.#publicExplorer);
		this.#replacePublicModelCatalog([]);

		this.#save = settingsButton(
			options.document,
			'ldp-config-action is-primary',
			'保存 AI 服务',
			'check',
			'保存服务',
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
		profileFields.append(footer);

		const root = element(
			options.document,
			'div',
			'ldp-settings-fields ldp-translation-settings ldp-ai-service-settings',
		);
		root.append(section);
		this.#host.replaceChildren(root);
		this.#surfaceHost.append(this.#modelMetadata);
		this.#modelMetadataPosition = new ReaderHeaderPopoverPosition({
			document: this.#document,
			root: this.#surfaceHost,
			toggle: this.#models,
			popover: this.#modelMetadata,
			parentScope: this.scope,
			preferredPlacement: 'top',
		});
		this.#publicModelMetadataPosition = new ReaderHeaderPopoverPosition({
			document: this.#document,
			root: this.#surfaceHost,
			toggle: this.#publicModels,
			popover: this.#modelMetadata,
			parentScope: this.scope,
			preferredPlacement: 'top',
		});
		this.scope.listen(this.#baseUrl, 'change', () => this.#invalidateModels());
		this.scope.listen(this.#apiKey, 'change', () => this.#invalidateModels());
		this.scope.listen(this.#baseUrl, 'input', () => this.#syncProfileSummary());
		this.scope.listen(this.#apiKey, 'input', () => this.#syncProfileSummary());
		this.scope.listen(this.#profile, 'change', () => this.#selectProfile());
		this.scope.listen(this.#models, 'change', () => this.#syncModelMetadata());
		this.scope.listen(this.#publicModels, 'change', () =>
			this.#syncPublicModelMetadata());
		this.scope.listen(this.#models, READER_SELECT_RESELECT_EVENT, () =>
			this.#syncModelMetadata());
		this.scope.listen(this.#publicModels, READER_SELECT_RESELECT_EVENT, () =>
			this.#syncPublicModelMetadata());
		this.scope.listen(this.#models, 'pointerdown', () =>
			this.#hideModelMetadata());
		this.scope.listen(this.#publicModels, 'pointerdown', () =>
			this.#hideModelMetadata());
		this.scope.listen(this.#modelMetadata, 'pointerdown', (event) =>
			event.stopPropagation());
		this.scope.listen(this.#publicExplorerToggle, 'click', () =>
			void this.#togglePublicExplorer());
		this.scope.listen(this.#publicRefresh, 'click', () =>
			void this.#refreshPublicCatalog(true));
		this.scope.listen(this.#modelMetadataClose, 'click', () =>
			this.#hideModelMetadata(true));
		this.scope.listen(this.#document, 'pointerdown', (event) => {
			if (this.#modelMetadata.hidden) return;
			const path = event.composedPath();
			const selectSurface = this.#metadataAnchor?.closest('.ldp-select-surface');
			if (
				path.includes(this.#modelMetadata) ||
				(this.#metadataAnchor && path.includes(this.#metadataAnchor)) ||
				(selectSurface && path.includes(selectSurface))
			) return;
			this.#hideModelMetadata();
		}, true);
		this.scope.listen(this.#document, 'keydown', (eventValue) => {
			const event = eventValue as KeyboardEvent;
			if (event.key !== 'Escape' || this.#modelMetadata.hidden) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			this.#hideModelMetadata(true);
		}, true);
		const settingsPanel = this.#host.closest<HTMLElement>('.ldp-settings-panel');
		if (settingsPanel) this.scope.listen(settingsPanel, 'scroll', () => {
			if (this.#metadataAnchor === this.#publicModels) {
				this.#publicModelMetadataPosition.schedule();
			} else {
				this.#modelMetadataPosition.schedule();
			}
		});
		this.scope.listen(this.#addProfile, 'click', () => this.#startNewProfile());
		this.scope.listen(this.#removeProfile, 'click', () =>
			void this.#removeCurrentProfile());
		this.scope.listen(this.#save, 'click', () => void this.#saveConfig());
		this.scope.listen(this.#loadModels, 'click', () => void this.#fetchModels());
		this.scope.add(() => {
			this.#operation?.abort(new Error('AI 服务设置已关闭'));
			this.#publicOperation?.abort(new Error('AI 服务设置已关闭'));
			this.#modelMetadata.remove();
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
		const current = this.#repository.snapshot.config;
		const template = this.#editingBaseUrl
			? current.profiles.find((entry) =>
				entry.baseUrl === this.#editingBaseUrl)
			: null;
		const access = this.#accessDraft();
		const sameIdentity = template !== null && template !== undefined &&
			this.#identity(template) === this.#identity(access);
		const catalogMatches = this.#catalogIdentity === this.#identity(access);
		return {
			...(template ?? createReaderTranslationDefaultProfile()),
			...access,
			models: catalogMatches
				? Object.freeze(this.#catalog.map((entry) => entry.id))
				: Object.freeze([]),
			modelCatalog: catalogMatches ? this.#catalog : Object.freeze([]),
			model: sameIdentity ? template.model : '',
			animation: current.animation,
		};
	}

	#identity(config: ReaderTranslationAccessConfig = this.#accessDraft()): string {
		return `${normalizeReaderTranslationBaseUrl(config.baseUrl)}\u0000${config.apiKey}`;
	}

	#replaceModelCatalog(catalog: readonly ReaderAiModelCatalogEntry[]): void {
		this.#catalog = Object.freeze(catalog.slice(0, 1_000));
		const placeholder = settingsOption(
			this.#document,
			'',
			this.#catalog.length
				? `已缓存 ${this.#catalog.length} 个模型`
				: '尚未缓存模型',
		);
		placeholder.disabled = true;
		placeholder.selected = true;
		this.#models.replaceChildren(
			placeholder,
			...readerAiModelKindGroups(this.#catalog).map((group) => {
				const options = this.#document.createElement('optgroup');
				options.label = group.label;
				options.append(...group.models.map((entry) => settingsOption(
					this.#document,
					entry.id,
					readerAiModelIdentityLabel(entry),
				)));
				return options;
			}),
		);
		this.#models.disabled = this.#operation !== null ||
			this.#catalog.length === 0;
		this.#hideModelMetadata();
	}

	#replacePublicModelCatalog(
		catalog: readonly ReaderAiModelCatalogEntry[],
	): void {
		const selected = selectedValue(this.#publicModels);
		this.#publicCatalog = Object.freeze(catalog.slice(0, 5_000));
		const placeholder = settingsOption(
			this.#document,
			'',
			this.#publicCatalog.length
				? `公共目录 ${this.#publicCatalog.length} 个模型`
				: '公共目录尚未缓存',
		);
		placeholder.disabled = true;
		placeholder.selected = true;
		this.#publicModels.replaceChildren(
			placeholder,
			...readerAiModelKindGroups(this.#publicCatalog).map((group) => {
				const options = this.#document.createElement('optgroup');
				options.label = group.label;
				options.append(...group.models.map((entry) => settingsOption(
					this.#document,
					entry.id,
					readerAiModelIdentityLabel(entry),
				)));
				return options;
			}),
		);
		this.#publicModels.disabled = this.#publicOperation !== null ||
			this.#publicCatalog.length === 0;
		if (this.#publicCatalog.some((entry) => entry.id === selected)) {
			selectValue(this.#publicModels, selected);
		}
		if (this.#metadataAnchor === this.#models) {
			this.#syncModelMetadata();
		} else if (
			this.#metadataAnchor === this.#publicModels &&
			this.#publicCatalog.some((entry) => entry.id === selected)
		) {
			this.#syncPublicModelMetadata();
		} else if (this.#metadataAnchor === this.#publicModels) {
			this.#hideModelMetadata();
		}
	}

	#hideModelMetadata(restoreFocus = false): void {
		this.#modelMetadata.hidden = true;
		this.#modelMetadata.setAttribute('aria-hidden', 'true');
		if (restoreFocus && this.#metadataAnchor?.isConnected) {
			this.#metadataAnchor.focus({ preventScroll: true });
		}
		this.#metadataAnchor = null;
	}

	#syncModelMetadata(): void {
		const providerEntry = this.#catalog.find((candidate) =>
			candidate.id === selectedValue(this.#models));
		const publicEntry = providerEntry
			? findReaderAiModelCatalogExactMatch(providerEntry, this.#publicCatalog)
			: null;
		const entry = providerEntry && publicEntry
			? mergeReaderAiModelCatalogEntries(providerEntry, publicEntry, true)
			: providerEntry;
		this.#renderModelMetadata(
			entry,
			this.#models,
			this.#modelMetadataPosition,
		);
	}

	#syncPublicModelMetadata(): void {
		const entry = this.#publicCatalog.find((candidate) =>
			candidate.id === selectedValue(this.#publicModels));
		this.#renderModelMetadata(
			entry,
			this.#publicModels,
			this.#publicModelMetadataPosition,
		);
	}

	#renderModelMetadata(
		entry: ReaderAiModelCatalogEntry | undefined,
		anchor: HTMLSelectElement,
		position: ReaderHeaderPopoverPosition,
	): void {
		if (!entry) {
			this.#hideModelMetadata();
			this.#modelMetadata.replaceChildren();
			return;
		}
		const kind = readerAiModelKindGroups([entry])[0]?.label ?? '';
		const kindIsInferred = !entry.inputModalities.length &&
			!entry.outputModalities.length &&
			!entry.supportedParameters.length;
		const header = element(
			this.#document,
			'header',
			'ldp-ai-service-model-metadata-header',
		);
		const heading = element(
			this.#document,
			'span',
			'ldp-ai-service-model-metadata-heading',
		);
		const title = element(this.#document, 'strong');
		title.textContent = entry.name || entry.id;
		const identifier = element(this.#document, 'code');
		identifier.textContent = entry.id;
		const sources = element(
			this.#document,
			'span',
			'ldp-ai-service-model-sources',
		);
		sources.append(...entry.metadataSources.map((source) => {
			const badge = element(this.#document, 'span');
			badge.textContent = metadataSourceLabel(source);
			return badge;
		}));
		heading.append(title, identifier, sources);
		header.append(heading, this.#modelMetadataClose);

		const fact = (label: string, value: string): HTMLElement | null => {
			if (!value) return null;
			const row = element(this.#document, 'div');
			const term = element(this.#document, 'dt');
			term.textContent = `${label}：`;
			const detail = element(this.#document, 'dd');
			detail.textContent = value;
			row.append(term, detail);
			return row;
		};
		const section = (
			label: string,
			children: readonly HTMLElement[],
			className = '',
		): HTMLElement | null => {
			if (!children.length) return null;
			const root = element(
				this.#document,
				'section',
				`ldp-ai-service-model-section ${className}`.trim(),
			);
			const sectionTitle = element(this.#document, 'h4');
			sectionTitle.textContent = label;
			root.append(sectionTitle, ...children);
			return root;
		};
		const specifications = [
			fact('类型', `${kind || '未分类'}${kindIsInferred ? '（名称推断）' : ''}`),
			fact('规范 ID', entry.canonicalId !== entry.id ? entry.canonicalId : ''),
			fact('提供方', entry.ownedBy),
			fact('模型系列', entry.family),
			fact('上下文窗口', entry.contextLength
				? compactTokenCount(entry.contextLength)
				: ''),
			fact('最大输入', entry.inputTokenLimit
				? compactTokenCount(entry.inputTokenLimit)
				: ''),
			fact('最大输出', entry.maxCompletionTokens
				? compactTokenCount(entry.maxCompletionTokens)
				: ''),
			fact('知识截止', entry.knowledgeCutoff),
			fact('发布时间', entry.releaseDate || modelCreatedAtLabel(entry.created)),
			fact('元数据更新', entry.lastUpdated),
		].filter((item): item is HTMLElement => item !== null);
		const capabilities = [
			fact('输入模态', entry.inputModalities.join('、')),
			fact('输出模态', entry.outputModalities.join('、')),
			fact('思考等级', entry.reasoningEfforts.join('、')),
			fact('请求参数', entry.supportedParameters.join('、')),
			fact('附件', capabilityLabel(entry.attachment)),
			fact('推理', capabilityLabel(entry.reasoning)),
			fact('工具调用', capabilityLabel(entry.toolCall)),
			fact('结构化输出', capabilityLabel(entry.structuredOutput)),
			fact('温度控制', capabilityLabel(entry.temperatureControl)),
			fact('开放权重', capabilityLabel(entry.openWeights)),
		].filter((item): item is HTMLElement => item !== null);
		const scores = [
			fact('智能指数', entry.intelligenceScore
				? String(Number(entry.intelligenceScore.toFixed(1)))
				: ''),
			fact('编程指数', entry.codingScore
				? String(Number(entry.codingScore.toFixed(1)))
				: ''),
			fact('Agent 指数', entry.agenticScore
				? String(Number(entry.agenticScore.toFixed(1)))
				: ''),
			fact('设计 Arena ELO', entry.designArenaElo
				? String(Number(entry.designArenaElo.toFixed(1)))
				: ''),
		].filter((item): item is HTMLElement => item !== null);
		if (entry.benchmarks.length) {
			const tableSurface = element(
				this.#document,
				'div',
				'ldp-ai-service-model-benchmark-surface',
			);
			const table = element(
				this.#document,
				'table',
				'ldp-ai-service-model-benchmark-table',
			);
			table.setAttribute('aria-label', '模型基准成绩');
			const head = element(this.#document, 'thead');
			const headRow = element(this.#document, 'tr');
			for (const label of ['基准', '分数', '口径']) {
				const cell = element(this.#document, 'th');
				cell.scope = 'col';
				cell.textContent = label;
				headRow.append(cell);
			}
			head.append(headRow);
			const bodyRows = element(this.#document, 'tbody');
			for (const benchmark of entry.benchmarks) {
				const row = element(this.#document, 'tr');
				const name = element(this.#document, 'th');
				name.scope = 'row';
				name.textContent = benchmark.name;
				const score = element(
					this.#document,
					'td',
					'ldp-ai-service-model-benchmark-score',
				);
				score.textContent = String(Number(benchmark.score.toFixed(2)));
				const detail = element(this.#document, 'td');
				detail.textContent = [
					benchmark.metric,
					benchmark.variant,
					benchmark.version
						? `v${benchmark.version.replace(/^v/iu, '')}`
						: '',
				].filter(Boolean).join(' · ');
				row.append(name, score, detail);
				bodyRows.append(row);
			}
			table.append(head, bodyRows);
			tableSurface.append(table);
			scores.push(tableSurface);
		}
		const priceSource = metadataSourceLabel(entry.pricingSource);
		const pricing = [
			fact(
				`${priceSource || '目录'}输入${priceSource === '当前供应商' ? '价' : '参考价'}`,
				pricePerMillionLabel(entry.promptPrice),
			),
			fact(
				`${priceSource || '目录'}输出${priceSource === '当前供应商' ? '价' : '参考价'}`,
				pricePerMillionLabel(entry.completionPrice),
			),
		].filter((item): item is HTMLElement => item !== null);
		const body = element(
			this.#document,
			'div',
			'ldp-ai-service-model-metadata-body',
		);
		body.append(...[
			section('模型规格', specifications, 'is-specifications'),
			section('模态与能力', capabilities, 'is-capabilities'),
			section('能力基准', scores, 'is-benchmarks'),
			section('价格', pricing, 'is-pricing'),
		].filter((item): item is HTMLElement => item !== null));
		if (entry.description) {
			const description = element(
				this.#document,
				'p',
				'ldp-ai-service-model-description',
			);
			description.textContent = entry.description;
			body.append(description);
		}
		const sourceNote = element(
			this.#document,
			'small',
			'ldp-ai-service-model-source-note',
		);
		const hasProvider = entry.metadataSources.includes('provider');
		const hasPublicSource = entry.metadataSources.some((source) =>
			source !== 'provider');
		sourceNote.textContent = hasProvider && hasPublicSource
			? '公共目录只补空字段；当前供应商返回的限制与价格始终优先。'
			: hasPublicSource
				? '这是公共目录参考数据，不代表当前供应商实际开放该模型。'
				: '公共目录未精确匹配；这里只展示当前供应商已返回的数据。';
		body.append(sourceNote);
		this.#modelMetadata.replaceChildren(header, body);
		this.#metadataAnchor = anchor;
		this.#modelMetadata.removeAttribute('aria-hidden');
		this.#modelMetadata.hidden = false;
		position.position();
	}

	async #ensurePublicMetadataCacheLoaded(): Promise<void> {
		if (this.#publicCacheLoaded) return;
		if (this.#publicCacheLoadPromise) return this.#publicCacheLoadPromise;
		const pending = (async () => {
			try {
				const cached = await this.#repository.loadModelMetadataCache();
				if (!cached || this.scope.destroyed) return;
				this.#publicCatalogFetchedAt = cached.fetchedAt;
				this.#replacePublicModelCatalog(cached.catalog);
				this.#publicExplorerStatus.textContent =
					`已读取本地缓存 · ${new Date(cached.fetchedAt).toLocaleDateString('zh-CN')}`;
			} catch {
				// 缓存损坏不阻塞公共目录重新获取。
			}
		})();
		this.#publicCacheLoadPromise = pending;
		try {
			await pending;
		} finally {
			this.#publicCacheLoaded = true;
			if (this.#publicCacheLoadPromise === pending) {
				this.#publicCacheLoadPromise = null;
			}
		}
	}

	#publicCacheExpired(): boolean {
		return this.#publicCatalogFetchedAt > 0 &&
			Date.now() - this.#publicCatalogFetchedAt >
				READER_AI_MODEL_METADATA_CACHE_MAX_AGE_MS;
	}

	async #refreshPublicCatalog(forceRefresh: boolean): Promise<void> {
		await this.#ensurePublicMetadataCacheLoaded();
		if (this.#publicOperation) return;
		if (
			!forceRefresh &&
			this.#publicCatalog.length &&
			!this.#publicCacheExpired()
		) return;
		const cachedAt = this.#publicCatalogFetchedAt;
		const operation = new AbortController();
		this.#publicOperation = operation;
		this.#publicModels.disabled = this.#publicCatalog.length === 0;
		this.#publicExplorerToggle.dataset.loading = 'true';
		this.#publicRefresh.dataset.loading = 'true';
		this.#publicRefresh.disabled = true;
		this.#publicExplorerStatus.textContent = forceRefresh
			? '正在强制刷新公共模型元数据…'
			: cachedAt
				? '缓存已过期，正在后台更新公共模型目录…'
			: '正在获取公共模型目录…';
		try {
			const result = await this.#access.listPublicModels(
				operation.signal,
				forceRefresh || cachedAt > 0,
			);
			const cache = await this.#repository.saveModelMetadataCache({
				fetchedAt: Date.now(),
				catalog: result.catalog,
			});
			this.#publicCatalogFetchedAt = cache.fetchedAt;
			this.#replacePublicModelCatalog(cache.catalog);
			this.#publicExplorerStatus.textContent =
				`${forceRefresh ? '已强制刷新' : '已缓存'} ` +
				`${cache.catalog.length} 个公共模型 · ` +
				new Date(cache.fetchedAt).toLocaleDateString('zh-CN');
		} catch (cause) {
			if (!operation.signal.aborted) {
				this.#publicExplorerStatus.textContent = cachedAt
					? '公共目录更新失败，继续使用已有缓存。'
					: cause instanceof Error
						? cause.message
						: '公共模型目录获取失败';
			}
		} finally {
			if (this.#publicOperation === operation) this.#publicOperation = null;
			delete this.#publicExplorerToggle.dataset.loading;
			delete this.#publicRefresh.dataset.loading;
			this.#publicRefresh.disabled = false;
			this.#publicModels.disabled = this.#publicCatalog.length === 0;
		}
	}

	async #togglePublicExplorer(): Promise<void> {
		const open = this.#publicExplorer.hidden;
		this.#publicExplorer.hidden = !open;
		this.#publicExplorerToggle.setAttribute('aria-expanded', String(open));
		if (!open) {
			if (this.#metadataAnchor === this.#publicModels) {
				this.#hideModelMetadata();
			}
			return;
		}
		await this.#ensurePublicMetadataCacheLoaded();
		if (!this.#publicCatalog.length || this.#publicCacheExpired()) {
			void this.#refreshPublicCatalog(false);
		}
	}

	#invalidateModels(): void {
		if (this.#catalogIdentity === this.#identity()) return;
		this.#catalogIdentity = null;
		this.#replaceModelCatalog([]);
		this.#syncProfileSummary();
		this.#renderStatus('连接信息已变化，请重新获取模型。');
	}

	#syncProfileSummary(): void {
		const normalizedUrl = normalizeReaderTranslationBaseUrl(this.#baseUrl.value);
		this.#profileIdentity.textContent = normalizedUrl
			? normalizedUrl.replace(/\/$/u, '')
			: this.#baseUrl.value.trim() || '尚未填写 URL';
		let state = '未启用 AI';
		let kind = 'inactive';
		if (this.#editingBaseUrl === null) {
			state = '新建草稿';
			kind = 'draft';
		} else if (this.#apiKey.value.trim() && this.#catalog.length) {
			state = `已缓存 ${this.#catalog.length} 个模型`;
			kind = 'ready';
		} else if (this.#apiKey.value.trim()) {
			state = '待获取模型';
			kind = 'pending';
		}
		this.#profileState.textContent = state;
		this.#profileState.dataset.profileState = kind;
	}

	#syncDraftActions(draft: boolean): void {
		this.#removeProfile.setAttribute(
			'aria-label',
			draft ? '取消新增 AI 服务' : '删除当前 AI 服务',
		);
		const label = this.#removeProfile.querySelector('span');
		if (label) label.textContent = draft ? '取消新增' : '删除服务';
	}

	#renderProfileOptions(
		config: ReaderTranslationConfig,
		preferred = config.activeBaseUrl,
	): void {
		this.#profile.replaceChildren(...config.profiles.map((profile) =>
			settingsOption(
				this.#document,
				profile.baseUrl,
				profile.baseUrl.replace(/\/$/u, ''),
			)));
		selectValue(this.#profile, preferred);
		this.#profileCount.textContent = `${config.profiles.length} 个已保存服务`;
	}

	#loadProfile(profile: ReaderTranslationProfile): void {
		this.#editingBaseUrl = normalizeReaderTranslationBaseUrl(profile.baseUrl) || null;
		this.#baseUrl.value = profile.baseUrl;
		this.#apiKey.value = profile.apiKey;
		this.#replaceModelCatalog(profile.modelCatalog);
		this.#catalogIdentity = profile.models.length ? this.#identity(profile) : null;
		this.#syncDraftActions(false);
		this.#syncProfileSummary();
	}

	#selectProfile(): void {
		const url = selectedValue(this.#profile);
		const profile = this.#repository.snapshot.config.profiles.find((entry) =>
			entry.baseUrl === url);
		if (!profile) return;
		this.#loadProfile(profile);
		this.#renderStatus(profile.apiKey && profile.models.length
			? `当前供应商已缓存 ${profile.models.length} 个模型；各业务可分组选择。`
			: '当前服务尚未启用 AI；正文翻译仍可使用公共服务。');
	}

	#startNewProfile(): void {
		if (
			this.#editingBaseUrl === null &&
			selectedValue(this.#profile) === '__new__'
		) {
			this.#baseUrl.focus();
			return;
		}
		this.#editingBaseUrl = null;
		this.#profile.replaceChildren(
			...this.#repository.snapshot.config.profiles.map((profile) =>
				settingsOption(
					this.#document,
					profile.baseUrl,
					profile.baseUrl.replace(/\/$/u, ''),
				)),
			settingsOption(this.#document, '__new__', '正在新建服务（未保存）'),
		);
		selectValue(this.#profile, '__new__');
		this.#baseUrl.value = '';
		this.#apiKey.value = '';
		this.#replaceModelCatalog([]);
		this.#catalogIdentity = null;
		this.#syncDraftActions(true);
		this.#syncProfileSummary();
		this.#renderStatus('请在下方填写 API URL 与 API Key。');
		this.#baseUrl.focus();
	}

	async #removeCurrentProfile(): Promise<void> {
		if (!this.#editingBaseUrl) {
			const current = this.#repository.snapshot.config;
			this.#renderProfileOptions(current);
			this.#loadProfile(readerTranslationActiveProfile(current));
			this.#renderStatus('已放弃未保存的新服务。');
			return;
		}
		const current = this.#repository.snapshot.config;
		const profiles = current.profiles.filter((profile) =>
			profile.baseUrl !== this.#editingBaseUrl);
		const next = normalizeReaderTranslationConfig({
			profiles,
			activeBaseUrl: current.activeBaseUrl === this.#editingBaseUrl
				? profiles[0]?.baseUrl
				: current.activeBaseUrl,
			animation: current.animation,
		});
		try {
			await this.#repository.saveConfig(next);
			const selected = readerTranslationActiveProfile(next);
			this.#renderProfileOptions(next, selected.baseUrl);
			this.#loadProfile(selected);
			this.#renderStatus(profiles.length
				? '已删除当前服务，并切换到下一项。'
				: '已删除最后一项；保留空白 OpenAI 默认入口供后续配置。', 'success');
		} catch (cause) {
			this.#renderStatus(cause instanceof Error
				? cause.message
				: '删除 AI 服务失败', 'error');
		}
	}

	async #load(): Promise<void> {
		try {
			const { config } = await this.#repository.load();
			if (this.scope.destroyed) return;
			await this.#ensurePublicMetadataCacheLoaded();
			if (this.scope.destroyed) return;
			this.#renderProfileOptions(config);
			const profile = readerTranslationActiveProfile(config);
			this.#loadProfile(profile);
			this.#renderStatus(profile.apiKey && profile.models.length
				? `当前供应商已缓存 ${profile.models.length} 个模型。`
				: '填写 Key 后获取模型目录；具体模型在各业务功能中选择。');
			if (this.#publicCacheExpired()) void this.#refreshPublicCatalog(false);
		} catch (cause) {
			this.#renderStatus(cause instanceof Error
				? cause.message
				: 'AI 服务读取失败', 'error');
		}
	}

	async #saveConfig(): Promise<boolean> {
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
			const activeBaseUrl = current.activeBaseUrl === this.#editingBaseUrl
				? baseUrl
				: current.activeBaseUrl;
			const config = normalizeReaderTranslationConfig({
				profiles,
				activeBaseUrl,
				animation: current.animation,
			});
			await this.#repository.saveConfig(config);
			const saved = config.profiles.find((entry) => entry.baseUrl === baseUrl)!;
			this.#renderProfileOptions(config, baseUrl);
			this.#loadProfile(saved);
			this.#renderStatus(saved.models.length
				? `已保存供应商与 ${saved.models.length} 个缓存模型。`
				: '已保存供应商；获取模型后，各业务才可选择该服务。', 'success');
			return true;
		} catch (cause) {
			this.#renderStatus(cause instanceof Error
				? cause.message
				: 'AI 服务保存失败', 'error');
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
			if (result.publicCatalog?.length) {
				this.#replacePublicModelCatalog(result.publicCatalog);
				try {
					const cache = await this.#repository.saveModelMetadataCache({
						fetchedAt: Date.now(),
						catalog: result.publicCatalog,
					});
					this.#publicCatalogFetchedAt = cache.fetchedAt;
				} catch {
					this.#publicExplorerStatus.textContent =
						'公共模型元数据暂存于当前页面，本地缓存写入失败。';
				}
			}
			this.#replaceModelCatalog(result.catalog);
			this.#catalogIdentity = this.#identity(access);
			const saved = await this.#saveConfig();
			if (saved) {
				const enriched = result.enrichedModels ?? 0;
				this.#renderStatus(
					enriched
						? `已缓存 ${result.models.length} 个供应商模型；公共目录精确补全 ${enriched} 个。`
						: `已缓存 ${result.models.length} 个供应商模型；公共目录没有精确匹配项。`,
					'success',
				);
			}
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
		this.#models.disabled = busy || this.#catalog.length === 0;
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
