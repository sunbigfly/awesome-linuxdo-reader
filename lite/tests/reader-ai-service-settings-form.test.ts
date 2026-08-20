import { parseHTML } from 'linkedom';
import { ReaderAiServiceSettingsForm } from
	'../src/settings/reader-ai-service-settings-form.js';
import { ReaderCacheObserver } from '../src/cache/cache-observer.js';
import { READER_SELECT_RESELECT_EVENT } from
	'../src/shell/reader-select-surface.js';
import {
	READER_AI_MODEL_METADATA_CACHE_MAX_AGE_MS,
	READER_AI_MODEL_METADATA_CACHE_STORAGE_KEY,
	READER_TRANSLATION_CONFIG_STORAGE_KEY,
	ReaderTranslationConfigRepository,
	createReaderTranslationDefaultProfile,
	normalizeReaderAiModelCatalogEntry,
	normalizeReaderTranslationConfig,
	readerTranslationActiveProfile,
} from '../src/translation/reader-translation-config.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const values = new Map<string, unknown>();
const repository = new ReaderTranslationConfigRepository({
	storage: {
		getValue: (key) => values.get(key) ?? null,
		setValue: (key, value) => {
			values.set(key, value);
		},
	},
});
const cacheObserver = new ReaderCacheObserver();
repository.attachCacheObserver(cacheObserver);
await repository.load();
const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body><main id="host"></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const host = document.querySelector<HTMLElement>('#host')!;
const fetchedCatalog = Object.freeze([
	normalizeReaderAiModelCatalogEntry({
		id: 'small-model',
		name: 'Small Image Model',
		created: 1_700_000_000,
		owned_by: 'example-provider',
		description: '生成小尺寸图像。',
		context_length: 32_000,
		max_completion_tokens: 4_000,
		pricing: { prompt: '0.000001', completion: '0.000002' },
		architecture: {
			input_modalities: ['text'],
			output_modalities: ['image'],
		},
	})!,
	normalizeReaderAiModelCatalogEntry({
		id: 'translation-model',
		canonical_id: 'openai/translation-model',
		name: 'Translation Model',
		family: 'translation-pro',
		created: 1_800_000_000,
		release_date: '2027-01-15',
		last_updated: '2027-01-20',
		knowledge: '2026-12',
		owned_by: 'openai',
		context_length: 200_000,
		input_token_limit: 180_000,
		max_completion_tokens: 16_000,
		architecture: {
			input_modalities: ['text', 'image'],
			output_modalities: ['text'],
		},
		supported_parameters: ['reasoning', 'tools', 'structured_outputs'],
		reasoning_efforts: ['low', 'medium', 'high'],
		attachment: true,
		reasoning: true,
		tool_call: true,
		structured_output: true,
		temperature: false,
		open_weights: false,
		pricing: { prompt: '0.000002', completion: '0.000008' },
		pricing_source: 'openrouter',
		benchmarks: [
			{ name: 'Artificial Analysis Intelligence Index', score: 72.5 },
			{ name: 'Artificial Analysis Coding Agent Index', score: 81.2 },
			{ name: 'Terminal-Bench', score: 68.4, metric: 'success rate' },
		],
		agentic_score: 66.8,
		metadata_sources: ['provider', 'models.dev', 'openrouter'],
	})!,
]);
let requestedAccess = '';
let publicCatalogRequests = 0;
let forcedPublicRefreshes = 0;
const form = new ReaderAiServiceSettingsForm({
	document,
	host,
	repository,
	access: {
		async listModels(config) {
			requestedAccess = `${config.baseUrl}|${config.apiKey}`;
			return Object.freeze({
				models: Object.freeze(fetchedCatalog.map((entry) => entry.id)),
				catalog: fetchedCatalog,
			});
		},
		async listPublicModels(_signal, forceRefresh = false) {
			publicCatalogRequests += 1;
			if (forceRefresh) forcedPublicRefreshes += 1;
			const catalog = Object.freeze(fetchedCatalog.map((entry) =>
				normalizeReaderAiModelCatalogEntry({
					...entry,
					id: entry.canonicalId,
					description: forceRefresh &&
						entry.canonicalId === 'openai/translation-model'
						? '公共目录已更新说明。'
						: entry.description,
					metadataSources: entry.metadataSources.filter((source) =>
						source !== 'provider'),
				})!).filter((entry) => entry.metadataSources.length));
			return Object.freeze({
				models: Object.freeze(catalog.map((entry) => entry.id)),
				catalog,
			});
		},
	},
});
await new Promise<void>((resolve) => setTimeout(resolve, 0));

assert(
	host.querySelector('input[aria-label="API URL"]') !== null &&
	host.querySelector('input[aria-label="API Key"]') !== null &&
	host.querySelector('select[aria-label="已缓存的可用模型目录"]') !== null &&
	host.querySelector('[aria-label="查询公共模型能力"]') !== null &&
	host.querySelector('[aria-label="强制刷新公共模型元数据"]') !== null &&
	host.querySelector('[aria-label="公共模型能力目录"]')?.closest(
		'.ldp-ai-model-public-explorer')?.hasAttribute('hidden') === true &&
	host.querySelector('input[aria-label="翻译温度"]') === null &&
	host.querySelector('textarea[aria-label="翻译 Prompt"]') === null &&
	host.textContent?.includes('各业务会单独选择供应商与模型') &&
	host.querySelector('.ldp-translation-profile-count')?.textContent ===
		'1 个已保存服务',
	'AI 服务面板必须独立承接供应商连接与缓存模型目录，不包含业务模型或翻译高级参数',
);

const baseUrl = host.querySelector<HTMLInputElement>('input[aria-label="API URL"]')!;
const apiKey = host.querySelector<HTMLInputElement>('input[aria-label="API Key"]')!;
const models = host.querySelector<HTMLSelectElement>(
	'select[aria-label="已缓存的可用模型目录"]',
)!;
const modelMetadata = host.querySelector<HTMLElement>(
	'[aria-label="所选模型元数据与能力"]',
)!;
const profileSelect = host.querySelector<HTMLSelectElement>(
	'select[aria-label="已保存 AI 服务"]',
)!;
assert(
	models.disabled && models.options.length === 1 && modelMetadata.hidden,
	'AI 服务不得预设或允许手填模型目录',
);

const publicExplorerToggle = host.querySelector<HTMLButtonElement>(
	'[aria-label="查询公共模型能力"]',
)!;
publicExplorerToggle.click();
await new Promise<void>((resolve) => setTimeout(resolve, 0));
await new Promise<void>((resolve) => setTimeout(resolve, 0));
const publicModels = host.querySelector<HTMLSelectElement>(
	'select[aria-label="公共模型能力目录"]',
)!;
assert(
	publicCatalogRequests === 1 &&
	values.has(READER_AI_MODEL_METADATA_CACHE_STORAGE_KEY) &&
	!publicModels.closest<HTMLElement>('.ldp-ai-model-public-explorer')?.hidden &&
	!publicModels.disabled &&
	publicModels.options.length === 2 &&
	host.textContent?.includes('已缓存 1 个公共模型'),
	`公共模型查询图标必须无需供应商 Key 获取目录，并把完整元数据独立持久缓存：${JSON.stringify({
		publicCatalogRequests,
		cached: values.has(READER_AI_MODEL_METADATA_CACHE_STORAGE_KEY),
		hidden: publicModels.closest<HTMLElement>(
			'.ldp-ai-model-public-explorer',
		)?.hidden,
		disabled: publicModels.disabled,
		options: publicModels.options.length,
		status: host.querySelector('.ldp-ai-model-public-explorer-status')
			?.textContent,
	})}`,
);
publicExplorerToggle.click();
publicExplorerToggle.click();
await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert(
	publicCatalogRequests === 1,
	'重复开关公共模型能力查询必须只读缓存，不能重复请求公共 API',
);

baseUrl.value = 'https://api.example.com/v1';
apiKey.value = 'secret-form-key';
host.querySelector<HTMLButtonElement>('[aria-label="保存 AI 服务"]')!.click();
await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert(
	values.has(READER_TRANSLATION_CONFIG_STORAGE_KEY) &&
	repository.snapshot.config.profiles.some((profile) =>
		profile.baseUrl === 'https://api.example.com/v1/' &&
		profile.models.length === 0),
	'供应商连接允许先保存，业务模型必须等缓存目录后再选择',
);

host.querySelector<HTMLButtonElement>(
	'[aria-label="从 /models 获取可用模型"]',
)!.click();
await new Promise<void>((resolve) => setTimeout(resolve, 0));
await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert(
	requestedAccess === 'https://api.example.com/v1/|secret-form-key' &&
	!models.disabled &&
	[...models.options].map((option) => option.value).join('|') ===
		'|translation-model|small-model' &&
	models.querySelectorAll('optgroup').length === 2 &&
	models.options[0]?.textContent === '已缓存 2 个模型' &&
	models.options[1]?.textContent ===
		'Translation Model' &&
	!host.textContent?.includes('仅查看') &&
	modelMetadata.hidden,
	`获取模型必须使用当前 URL 与 Key，并把完整目录写入只读下拉目录：${JSON.stringify({
		requestedAccess,
		models: [...models.options].map((option) => option.value),
		status: host.querySelector('[role="status"]')?.textContent,
	})}`,
);
const catalogConfig = repository.snapshot.config;
for (const option of models.options) {
	option.toggleAttribute('selected', option.value === 'small-model');
}
models.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
assert(
	repository.snapshot.config === catalogConfig &&
	readerTranslationActiveProfile(catalogConfig).model === '' &&
	!modelMetadata.hidden &&
	modelMetadata.role === 'dialog' &&
	modelMetadata.parentElement === host &&
	modelMetadata.querySelector('.ldp-ai-service-model-metadata-header') !== null &&
	modelMetadata.textContent?.includes('类型：图像生成') &&
	modelMetadata.textContent?.includes('输入模态：text') &&
	modelMetadata.textContent?.includes('输出模态：image') &&
	modelMetadata.textContent?.includes('上下文窗口：32K') &&
	modelMetadata.textContent?.includes('最大输出：4K') &&
	!modelMetadata.textContent?.includes('未返回') &&
	modelMetadata.textContent?.includes('提供方：example-provider') &&
	modelMetadata.textContent?.includes('发布时间：2023-11-14') &&
	modelMetadata.textContent?.includes('当前供应商输入价：$1/百万 Token') &&
	modelMetadata.textContent?.includes('当前供应商输出价：$2/百万 Token') &&
	modelMetadata.textContent?.includes('生成小尺寸图像。'),
	'目录选中模型后必须在浮动 HTML 卡片展示已知元数据，省略空占位且不得改写业务模型选择',
);
for (const option of models.options) {
	option.toggleAttribute('selected', option.value === 'translation-model');
}
models.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
assert(
	modelMetadata.textContent?.includes('类型：推理模型') &&
	modelMetadata.textContent?.includes('规范 ID：openai/translation-model') &&
	modelMetadata.textContent?.includes('模型系列：translation-pro') &&
	modelMetadata.textContent?.includes('输入模态：text、image') &&
	modelMetadata.textContent?.includes('思考等级：low、medium、high') &&
	modelMetadata.textContent?.includes(
		'请求参数：reasoning、tools、structured_outputs',
	) &&
	modelMetadata.textContent?.includes('智能指数：72.5') &&
	modelMetadata.textContent?.includes('编程指数：81.2') &&
	modelMetadata.textContent?.includes('Agent 指数：66.8') &&
	modelMetadata.querySelectorAll(
		'.ldp-ai-service-model-section.is-specifications > div',
	).length >= 6 &&
	modelMetadata.querySelectorAll(
		'table[aria-label="模型基准成绩"] thead th',
	).length === 3 &&
	modelMetadata.querySelector(
		'table[aria-label="模型基准成绩"] tbody tr:nth-child(3) th',
	)?.textContent === 'Terminal-Bench' &&
	modelMetadata.querySelector(
		'table[aria-label="模型基准成绩"] tbody tr:nth-child(3) ' +
			'td:nth-child(2)',
	)?.textContent === '68.4' &&
	modelMetadata.querySelector(
		'table[aria-label="模型基准成绩"] tbody tr:nth-child(3) ' +
			'td:nth-child(3)',
	)?.textContent === 'success rate' &&
	modelMetadata.textContent?.includes('OpenRouter输入参考价：$2/百万 Token') &&
	modelMetadata.textContent?.includes('Models.dev') &&
	!modelMetadata.textContent?.includes('未返回'),
	'模型浮卡必须展示缓存的规范信息、能力开关、思考等级、价格与完整基准列表',
);
host.querySelector<HTMLButtonElement>(
	'[aria-label="强制刷新公共模型元数据"]',
)!.click();
await new Promise<void>((resolve) => setTimeout(resolve, 0));
await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert(
	publicCatalogRequests === 2 && forcedPublicRefreshes === 1 &&
	repository.snapshot.config === catalogConfig &&
	modelMetadata.textContent?.includes('公共目录已更新说明。') &&
	host.textContent?.includes('已强制刷新 1 个公共模型'),
	'强制刷新必须只替换公共缓存并立即重绘供应商详情，不得改写供应商配置',
);
let escapedMetadataPointerDown = 0;
host.addEventListener('pointerdown', () => escapedMetadataPointerDown += 1);
modelMetadata.querySelector<HTMLButtonElement>(
	'[aria-label="关闭模型详情"]',
)!.dispatchEvent(new parsedWindow.Event('pointerdown', { bubbles: true }));
assert(
	escapedMetadataPointerDown === 0,
	'模型详情内的 pointerdown 不得冒泡成设置面板外部点击',
);
modelMetadata.querySelector<HTMLButtonElement>(
	'[aria-label="关闭模型详情"]',
)!.click();
assert(modelMetadata.hidden, '关闭模型详情只能关闭详情浮窗');
models.dispatchEvent(new parsedWindow.Event(
	READER_SELECT_RESELECT_EVENT,
	{ bubbles: true },
));
assert(
	!modelMetadata.hidden && modelMetadata.textContent?.includes('Translation Model'),
	'再次点击当前模型必须重新打开详情浮窗',
);
for (const option of publicModels.options) {
	option.toggleAttribute('selected', option.value === 'openai/translation-model');
}
publicModels.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
assert(
	!modelMetadata.hidden &&
	modelMetadata.textContent?.includes('openai/translation-model') &&
	modelMetadata.textContent?.includes(
		'这是公共目录参考数据，不代表当前供应商实际开放该模型。',
	),
	'公共模型查询结果必须复用同一能力浮卡，并明确不等于供应商实际可用列表',
);
let active = readerTranslationActiveProfile(repository.snapshot.config);
assert(
	active.baseUrl === 'https://api.example.com/v1/' &&
	active.apiKey === 'secret-form-key' &&
	active.model === '' &&
	active.models.join('|') === 'small-model|translation-model' &&
	active.temperature === 0.1 && active.reasoningEffort === 'none' &&
	values.has(READER_TRANSLATION_CONFIG_STORAGE_KEY),
	'模型获取后必须自动按供应商缓存，且不得替翻译业务限定模型',
);

await repository.saveConfig(normalizeReaderTranslationConfig({
	...repository.snapshot.config,
	profiles: repository.snapshot.config.profiles.map((profile) => ({
		...profile,
		prompt: '保留社区术语。',
		temperature: 0.2,
		reasoningEffort: 'high',
		requestsPerMinute: 60,
		tokensPerMinute: 200_000,
	})),
}));
host.querySelector<HTMLButtonElement>('[aria-label="新增 AI 服务"]')!.click();
baseUrl.value = 'https://second.example/v1';
apiKey.value = 'second-secret-key';
host.querySelector<HTMLButtonElement>(
	'[aria-label="从 /models 获取可用模型"]',
)!.click();
await new Promise<void>((resolve) => setTimeout(resolve, 0));
active = readerTranslationActiveProfile(repository.snapshot.config);
const first = repository.snapshot.config.profiles.find((profile) =>
	profile.baseUrl === 'https://api.example.com/v1/');
const second = repository.snapshot.config.profiles.find((profile) =>
	profile.baseUrl === 'https://second.example/v1/');
assert(
	repository.snapshot.config.profiles.length === 2 &&
	repository.snapshot.config.activeBaseUrl === 'https://api.example.com/v1/' &&
	active.apiKey === 'secret-form-key' && active.model === '' &&
	second?.apiKey === 'second-secret-key' && second.models.length === 2 &&
	first?.prompt === '保留社区术语。' && first.temperature === 0.2 &&
	first.reasoningEffort === 'high' && first.requestsPerMinute === 60 &&
	first.tokensPerMinute === 200_000,
	'新增供应商与缓存目录时不得改写翻译业务当前供应商或其他 Profile 参数',
);

for (const option of profileSelect.options) {
	option.toggleAttribute('selected', option.value === 'https://api.example.com/v1/');
}
profileSelect.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
assert(
	apiKey.value === 'secret-form-key' &&
	[...models.options].map((option) => option.value).join('|') ===
		'|translation-model|small-model' &&
	modelMetadata.hidden,
	'AI 服务集合必须能切换并恢复每个 URL 对应的 Key 与缓存模型目录',
);

const defaults = createReaderTranslationDefaultProfile();
assert(defaults.prompt.length > 0, '新增 AI 服务依赖的翻译默认参数必须保持有效');
form.destroy();
assert(!host.firstElementChild, 'AI 服务设置销毁后必须清理唯一 panel host');

const cachedPublicMetadata = values.get(
	READER_AI_MODEL_METADATA_CACHE_STORAGE_KEY,
) as Readonly<{ readonly catalog: readonly unknown[] }>;
values.set(READER_AI_MODEL_METADATA_CACHE_STORAGE_KEY, {
	...cachedPublicMetadata,
	fetchedAt: Date.now() - READER_AI_MODEL_METADATA_CACHE_MAX_AGE_MS - 1,
});
const restartConfig = repository.snapshot.config;
const restarted = new ReaderAiServiceSettingsForm({
	document,
	host,
	repository,
	access: {
		async listModels() {
			throw new Error('重启缓存验证不应请求供应商目录');
		},
		async listPublicModels(_signal, forceRefresh = false) {
			publicCatalogRequests += 1;
			if (forceRefresh) forcedPublicRefreshes += 1;
			const catalog = Object.freeze(fetchedCatalog.map((entry) =>
				normalizeReaderAiModelCatalogEntry({
					...entry,
					id: entry.canonicalId,
					metadataSources: entry.metadataSources.filter((source) =>
						source !== 'provider'),
				})!).filter((entry) => entry.metadataSources.length));
			return Object.freeze({
				models: Object.freeze(catalog.map((entry) => entry.id)),
				catalog,
			});
		},
	},
});
await new Promise<void>((resolve) => setTimeout(resolve, 0));
await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert(
	publicCatalogRequests === 3 && forcedPublicRefreshes === 2 &&
	repository.snapshot.config === restartConfig &&
	host.textContent?.includes('已缓存 1 个公共模型'),
	'设置重开必须先读过期缓存并后台强制更新公共资料，不得请求或改写供应商目录',
);
await repository.clearModelMetadataCache();
assert(
	values.get(READER_AI_MODEL_METADATA_CACHE_STORAGE_KEY) === null &&
	host.querySelector<HTMLSelectElement>(
		'select[aria-label="公共模型能力目录"]',
	)?.disabled === true &&
	host.textContent?.includes('公共模型元数据缓存已清理') &&
	cacheObserver.snapshot.events.some((event) =>
		event.operation === 'clear' &&
		event.source === 'userscript-value' &&
		event.key === READER_AI_MODEL_METADATA_CACHE_STORAGE_KEY &&
		event.outcome === 'success'),
	'公共模型元数据清理必须同步清空 GM 持久值和当前标签的目录投影',
);
restarted.destroy();
