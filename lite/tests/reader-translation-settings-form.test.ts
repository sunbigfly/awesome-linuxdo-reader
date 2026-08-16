import { parseHTML } from 'linkedom';
import { ReaderTranslationSettingsForm } from
	'../src/settings/reader-translation-settings-form.js';
import {
	ReaderTranslationConfigRepository,
	createReaderTranslationDefaultProfile,
	normalizeReaderAiModelCatalogEntry,
	normalizeReaderTranslationConfig,
	readerAiModelDisplayLabel,
	readerTranslationActiveProfile,
} from '../src/translation/reader-translation-config.js';
import type { ReaderTranslationTheme } from
	'../src/translation/reader-translation-presentation.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function selectedValue(select: HTMLSelectElement): string {
	return [...select.options].filter((option) =>
		option.selected || option.hasAttribute('selected')).at(-1)?.value ?? '';
}

const normalizedIdentityModel = normalizeReaderAiModelCatalogEntry({
	id: 'gpt-5.3-codex-spark',
	name: 'GPT-5.3 Codex Spark',
	context_length: 128_000,
})!;
assert(
	readerAiModelDisplayLabel(normalizedIdentityModel) ===
		'GPT-5.3 Codex Spark · 上下文 128K',
	'全部业务模型下拉必须折叠仅大小写与分隔符不同的重复名称和 ID',
);

const legacyProfile = createReaderTranslationDefaultProfile();
const migratedAnimation = normalizeReaderTranslationConfig({
	activeBaseUrl: 'https://legacy-second.example/v1/',
	profiles: [
		legacyProfile,
		{
			...legacyProfile,
			baseUrl: 'https://legacy-second.example/v1/',
			animation: 'blur',
		},
	],
});
assert(
	migratedAnimation.animation === 'blur' &&
	migratedAnimation.profiles.every((profile) => profile.animation === 'blur'),
	'旧版 Profile 动画必须从当前 URL 迁移为全局偏好',
);

const repository = new ReaderTranslationConfigRepository({
	storage: {
		getValue: () => null,
		setValue: () => {},
	},
});
await repository.load();
await repository.saveConfig(normalizeReaderTranslationConfig({
	profiles: [{
		...legacyProfile,
		baseUrl: 'https://api.example.com/v1/',
		apiKey: 'secret-form-key',
		models: ['shared-model', 'summary-model', 'translation-model'],
		modelCatalog: [{
			id: 'translation-model',
			name: 'Translation Pro',
			context_length: 200_000,
			architecture: { output_modalities: ['text'] },
			benchmarks: {
				artificial_analysis: { intelligence_index: 70 },
			},
		}],
		model: 'translation-model',
	}],
	activeBaseUrl: 'https://api.example.com/v1/',
	animation: 'fade',
}));
const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body><main id="host"></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const host = document.querySelector<HTMLElement>('#host')!;
let translationTheme: ReaderTranslationTheme = 'quote';
const form = new ReaderTranslationSettingsForm({
	document,
	host,
	repository,
	presentation: {
		readTheme: () => translationTheme,
		persistTheme: (theme) => {
			translationTheme = theme;
		},
	},
});
await Promise.resolve();

assert(
	host.querySelector('input[aria-label="API URL"]') === null &&
	host.querySelector('input[aria-label="API Key"]') === null &&
	host.querySelector('select[aria-label="正文翻译模型"]') !== null &&
	host.querySelector('input[aria-label="翻译温度"]') !== null &&
	host.querySelector('textarea[aria-label="翻译 Prompt"]') !== null &&
	host.textContent?.includes('温度、思考等级、RPM / TPM 与翻译 Prompt') &&
	host.textContent?.includes('正文翻译模型在此单独选择'),
	'翻译面板必须移除服务连接字段，并保留按供应商选择正文翻译模型的入口',
);
assert(
	host.querySelector('details')?.hasAttribute('open') === false &&
	host.querySelector('.ldp-translation-profile-group')?.textContent?.includes(
		'https://api.example.com/v1 · translation-model',
	) &&
	host.querySelector('.ldp-translation-profile-state')?.textContent ===
		'AI 翻译',
	'翻译高级设置必须显示当前业务所选供应商与模型，并保持默认折叠',
);

const inputs = [...host.querySelectorAll<HTMLInputElement>('input')];
const temperature = inputs.find((input) =>
	input.getAttribute('aria-label') === '翻译温度')!;
const reasoningEffort = host.querySelector<HTMLSelectElement>(
	'select[aria-label="思考等级"]',
)!;
const animation = host.querySelector<HTMLSelectElement>(
	'select[aria-label="译文出现动画"]',
)!;
const theme = host.querySelector<HTMLSelectElement>(
	'select[aria-label="译文呈现样式"]',
)!;
const model = host.querySelector<HTMLSelectElement>(
	'select[aria-label="正文翻译模型"]',
)!;
const customReasoningEffort = inputs.find((input) =>
	input.getAttribute('aria-label') === '自定义思考等级')!;
const requestsPerMinute = inputs.find((input) =>
	input.getAttribute('aria-label') === '每分钟请求数（RPM）')!;
const tokensPerMinute = inputs.find((input) =>
	input.getAttribute('aria-label') === '每分钟令牌数（TPM）')!;
const prompt = host.querySelector<HTMLTextAreaElement>(
	'textarea[aria-label="翻译 Prompt"]',
)!;
const themePreview = host.querySelector<HTMLElement>(
	'[aria-label="译文样式效果预览"]',
)!;
const animationPreview = host.querySelector<HTMLElement>(
	'[aria-label="译文动画效果预览"]',
)!;
const animationPreviewOutput = animationPreview.querySelector<HTMLElement>(
	'.ldp-translation-text',
)!;
const themeRow = theme.closest('.ldp-setting-option-row');
const animationRow = animation.closest('.ldp-setting-option-row');
const profileGroup = host.querySelector('.ldp-translation-profile-group');
assert(
	temperature.value === '0.1' &&
	selectedValue(reasoningEffort) === 'none' &&
	customReasoningEffort.hidden &&
	requestsPerMinute.value === '0' &&
	tokensPerMinute.value === '0' &&
	selectedValue(animation) === 'fade' &&
	selectedValue(theme) === 'quote' &&
	model.querySelectorAll('optgroup').length === 1 &&
	model.options.length === 4 &&
	model.options[1]?.textContent?.includes('Translation Pro') &&
	model.options[1]?.textContent?.includes('基准 70') &&
	model.options[1]?.textContent?.includes('上下文 200K') &&
	themePreview.dataset.translationTheme === 'quote' &&
	themePreview.textContent?.includes('知识会在分享中不断生长。') &&
	animationPreview.dataset.translationAnimation === 'fade' &&
	animationPreviewOutput.classList.contains('ldp-translation-enter') &&
	animationPreviewOutput.classList.contains('ldp-translation-segmented') &&
	animationPreviewOutput.querySelectorAll('.ldp-translation-segment').length === 4 &&
	themeRow?.nextElementSibling === animationRow &&
	animationRow?.nextElementSibling === profileGroup &&
	model.closest('.ldp-setting-option-row')?.parentElement === profileGroup,
	'翻译面板必须加载当前 Profile 的高级参数和全局呈现默认值',
);

for (const option of theme.options) {
	option.toggleAttribute('selected', option.value === 'highlight');
}
theme.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
assert(
	translationTheme === 'highlight' &&
	themePreview.dataset.translationTheme === 'highlight' &&
	host.textContent?.includes('译文样式已更新'),
	'译文样式必须独立保存、立即生效并同步更新预览实例',
);
for (const option of animation.options) {
	option.toggleAttribute('selected', option.value === 'typewriter');
}
animation.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert(
	repository.snapshot.config.animation === 'typewriter' &&
	repository.snapshot.config.profiles.every((profile) =>
		profile.animation === 'typewriter') &&
	animationPreview.dataset.translationAnimation === 'typewriter' &&
	animationPreviewOutput.classList.contains('ldp-translation-enter') &&
	!animationPreviewOutput.classList.contains('ldp-translation-segmented') &&
	animationPreviewOutput.firstElementChild !== null,
	'译文动画必须继续作为全局翻译偏好保存并用真实动画类重播预览',
);

prompt.value = '优先使用社区术语。';
temperature.value = '0.2';
for (const option of reasoningEffort.options) {
	option.toggleAttribute('selected', option.value === '__custom__');
}
reasoningEffort.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
customReasoningEffort.value = 'balanced-fast';
requestsPerMinute.value = '120';
tokensPerMinute.value = '500000';
host.querySelector<HTMLButtonElement>('[aria-label="保存翻译设置"]')!.click();
await new Promise<void>((resolve) => setTimeout(resolve, 0));
const saved = readerTranslationActiveProfile(repository.snapshot.config);
assert(
	saved.baseUrl === 'https://api.example.com/v1/' &&
	saved.apiKey === 'secret-form-key' &&
	saved.model === 'translation-model' &&
	saved.prompt === '优先使用社区术语。' &&
	saved.temperature === 0.2 &&
	saved.reasoningEffort === 'balanced-fast' &&
	saved.requestsPerMinute === 120 &&
	saved.tokensPerMinute === 500_000,
	'保存翻译参数必须保留 AI 服务的 URL、Key 与模型，只更新当前 Profile 的翻译字段',
);

await repository.saveConfig(normalizeReaderTranslationConfig({
	...repository.snapshot.config,
	profiles: [
		...repository.snapshot.config.profiles,
		{
			...legacyProfile,
			baseUrl: 'https://second.example/v1/',
			apiKey: 'second-secret',
			models: ['shared-model', 'second-model'],
			model: 'second-model',
			temperature: 0.7,
		},
	],
	activeBaseUrl: 'https://second.example/v1/',
}));
assert(
	temperature.value === '0.7' &&
	model.querySelectorAll('optgroup').length === 2 &&
	[...model.options].filter((option) => option.textContent === 'shared-model')
		.length === 2 &&
	host.querySelector('.ldp-translation-profile-group')?.textContent?.includes(
		'second-model',
	),
	'AI 服务面板切换当前服务后，翻译面板必须同步投影对应高级参数',
);

form.destroy();
assert(!host.firstElementChild, '翻译设置销毁后必须清理唯一 panel host');
