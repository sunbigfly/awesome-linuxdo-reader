import { parseHTML } from 'linkedom';
import { ReaderTranslationSettingsForm } from
	'../src/settings/reader-translation-settings-form.js';
import {
	READER_TRANSLATION_CONFIG_STORAGE_KEY,
	ReaderTranslationConfigRepository,
	readerTranslationActiveProfile,
	readerTranslationUsesAi,
} from '../src/translation/reader-translation-config.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function selectedValue(select: HTMLSelectElement): string {
	return [...select.options].filter((option) =>
		option.selected || option.hasAttribute('selected')).at(-1)?.value ?? '';
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
await repository.load();
const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body><main id="host"></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const host = document.querySelector<HTMLElement>('#host')!;
let requestedAccess = '';
const form = new ReaderTranslationSettingsForm({
	document,
	host,
	repository,
	access: {
		async listModels(config) {
			requestedAccess = `${config.baseUrl}|${config.apiKey}`;
			return Object.freeze({
				models: Object.freeze(['small-model', 'translation-model']),
			});
		},
	},
});
await Promise.resolve();
assert(
	host.querySelectorAll('input[type="text"],input[type="password"]').length === 3 &&
	host.querySelectorAll('select').length === 4 &&
	host.querySelectorAll('textarea').length === 1 &&
	host.querySelector('input[aria-label="翻译温度"]') !== null &&
	host.querySelector('input[type="password"]') !== null &&
	host.textContent?.includes('每个 URL 独立保存 Key、模型与翻译参数') &&
	host.textContent?.includes(
		'AI 为可选增强；未配置时默认使用 Google / Microsoft 公共翻译',
	) &&
	host.textContent?.includes(
		'留空仍使用 Google / Microsoft 公共翻译',
	),
	'翻译设置主区必须提供多 URL 集合、Key、服务端模型与译文动画，高级区保留温度、思考等级与 Prompt',
);
assert(
	host.querySelector('details')?.hasAttribute('open') === false &&
	host.querySelector(
		'.ldp-translation-collection-group .ldp-translation-profile-control',
	) !== null &&
	host.querySelector(
		'.ldp-translation-profile-group .ldp-translation-profile-fields',
	) !== null &&
	host.querySelector('.ldp-translation-profile-count')?.textContent ===
		'1 个已保存服务' &&
	host.querySelector('.ldp-translation-profile-state')?.textContent ===
		'公共翻译',
	'设置必须把服务集合与所选 URL 的完整配置拆成两个可辨认的嵌套分组，高级设置默认折叠',
);

const inputs = [...host.querySelectorAll<HTMLInputElement>('input')];
const baseUrl = inputs.find((input) => input.getAttribute('aria-label') === 'API URL')!;
const apiKey = inputs.find((input) => input.getAttribute('aria-label') === 'API Key')!;
const model = host.querySelector<HTMLSelectElement>('select[aria-label="模型"]')!;
const temperature = inputs.find((input) =>
	input.getAttribute('aria-label') === '翻译温度')!;
const reasoningEffort = host.querySelector<HTMLSelectElement>(
	'select[aria-label="思考等级"]',
)!;
const animation = host.querySelector<HTMLSelectElement>(
	'select[aria-label="译文出现动画"]',
)!;
const customReasoningEffort = inputs.find((input) =>
	input.getAttribute('aria-label') === '自定义思考等级')!;
const requestsPerMinute = inputs.find((input) =>
	input.getAttribute('aria-label') === '每分钟请求数（RPM）')!;
const tokensPerMinute = inputs.find((input) =>
	input.getAttribute('aria-label') === '每分钟令牌数（TPM）')!;
const prompt = host.querySelector<HTMLTextAreaElement>('textarea')!;
assert(
	model.disabled && temperature.value === '0.1' &&
	[...animation.options].some((option) =>
		option.value === 'spring' && option.textContent === '弹性落字') &&
	[...animation.options].some((option) =>
		(option.selected || option.hasAttribute('selected')) &&
		option.value === 'fade') &&
	[...reasoningEffort.options].some((option) =>
		(option.selected || option.hasAttribute('selected')) &&
		option.value === 'none') &&
	customReasoningEffort.hidden &&
	requestsPerMinute.value === '0' &&
	tokensPerMinute.value === '0',
	`默认不得预设模型；动画逐词浮现、温度 0.1、思考关闭且隐藏自定义输入：` +
		`modelDisabled=${String(model.disabled)}, temperature=${temperature.value}, ` +
		`reasoning=${[...reasoningEffort.options].filter((option) =>
			option.selected || option.hasAttribute('selected'))
			.map((option) => option.value).join(',')}, customHidden=${String(
			customReasoningEffort.hidden,
		)}`,
);
baseUrl.value = 'https://api.example.com/v1';
apiKey.value = 'secret-form-key';
host.querySelector<HTMLButtonElement>('[aria-label="保存翻译设置"]')!.click();
await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert(
	host.textContent?.includes('请先从 /models 获取并选择模型') &&
	!values.has(READER_TRANSLATION_CONFIG_STORAGE_KEY),
	'填写 Key 后必须先从服务端模型目录选择，不能使用预设或手动模型',
);

host.querySelector<HTMLButtonElement>(
	'[aria-label="从 /models 获取可用模型"]',
)!.click();
await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert(
	requestedAccess === 'https://api.example.com/v1|secret-form-key' &&
	model.options.length === 3 &&
	!Boolean(model.disabled) &&
	host.textContent?.includes('已获取 2 个模型'),
	'获取模型必须使用当前 URL 与 Key，并把 /models 返回值投影为可选择目录',
);
for (const option of [...model.options]) {
	option.selected = option.value === 'translation-model';
}
prompt.value = '优先使用社区术语。';
temperature.value = '0.2';
for (const option of reasoningEffort.options) {
	option.toggleAttribute('selected', option.value === '__custom__');
}
reasoningEffort.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
customReasoningEffort.value = 'balanced-fast';
requestsPerMinute.value = '120';
tokensPerMinute.value = '500000';
for (const option of animation.options) {
	option.toggleAttribute('selected', option.value === 'typewriter');
}
host.querySelector<HTMLButtonElement>('[aria-label="保存翻译设置"]')!.click();
await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert(
	readerTranslationUsesAi(repository.snapshot.config) &&
	readerTranslationActiveProfile(repository.snapshot.config).baseUrl ===
		'https://api.example.com/v1/' &&
	readerTranslationActiveProfile(repository.snapshot.config).apiKey ===
		'secret-form-key' &&
	readerTranslationActiveProfile(repository.snapshot.config).model ===
		'translation-model' &&
	readerTranslationActiveProfile(repository.snapshot.config).temperature === 0.2 &&
	readerTranslationActiveProfile(repository.snapshot.config).reasoningEffort ===
		'balanced-fast' &&
	readerTranslationActiveProfile(repository.snapshot.config).requestsPerMinute ===
		120 &&
	readerTranslationActiveProfile(repository.snapshot.config).tokensPerMinute ===
		500_000 &&
	readerTranslationActiveProfile(repository.snapshot.config).animation ===
		'typewriter' &&
	host.querySelector('.ldp-translation-profile-state')?.textContent ===
		'AI 已配置' &&
	values.has(READER_TRANSLATION_CONFIG_STORAGE_KEY),
	'服务端模型选择、思考等级自定义值和折叠高级参数必须保存到独立用户脚本配置',
);

host.querySelector<HTMLButtonElement>('[aria-label="新增翻译 URL"]')!.click();
assert(
	host.querySelector('.ldp-translation-profile-state')?.textContent ===
		'新建草稿' &&
	host.querySelector('.ldp-translation-profile-group')?.textContent?.includes(
		'尚未填写 URL',
	),
	'新增 URL 时必须在独立服务配置卡片中明确显示草稿状态',
);
baseUrl.value = 'https://second.example/v1';
apiKey.value = 'second-secret-key';
host.querySelector<HTMLButtonElement>(
	'[aria-label="从 /models 获取可用模型"]',
)!.click();
await new Promise<void>((resolve) => setTimeout(resolve, 0));
for (const option of [...model.options]) {
	option.toggleAttribute('selected', option.value === 'small-model');
}
host.querySelector<HTMLButtonElement>('[aria-label="保存翻译设置"]')!.click();
await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert(
	repository.snapshot.config.profiles.length === 2 &&
	host.querySelector('.ldp-translation-profile-count')?.textContent ===
		'2 个已保存服务' &&
	repository.snapshot.config.activeBaseUrl === 'https://second.example/v1/' &&
	repository.snapshot.config.profiles.some((profile) =>
		profile.baseUrl === 'https://api.example.com/v1/' &&
		profile.apiKey === 'secret-form-key' &&
		profile.animation === 'typewriter' &&
		profile.reasoningEffort === 'balanced-fast' &&
		profile.requestsPerMinute === 120 &&
		profile.tokensPerMinute === 500_000) &&
	readerTranslationActiveProfile(repository.snapshot.config).apiKey ===
		'second-secret-key' &&
	readerTranslationActiveProfile(repository.snapshot.config).animation === 'fade' &&
	readerTranslationActiveProfile(repository.snapshot.config).reasoningEffort === 'none' &&
	readerTranslationActiveProfile(repository.snapshot.config).requestsPerMinute === 0 &&
	readerTranslationActiveProfile(repository.snapshot.config).tokensPerMinute === 0,
	'用户必须能持续新增 URL 服务项，并在切换当前项时保留各 URL 对应的独立 Key：' +
		JSON.stringify(repository.snapshot.config) + ` text=${host.textContent}`,
);
const profileSelect = host.querySelector<HTMLSelectElement>(
	'select[aria-label="当前翻译服务"]',
)!;
for (const option of profileSelect.options) {
	option.toggleAttribute(
		'selected',
		option.value === 'https://api.example.com/v1/',
	);
}
profileSelect.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
assert(
	apiKey.value === 'secret-form-key' &&
	prompt.value === '优先使用社区术语。' &&
	temperature.value === '0.2' &&
	selectedValue(model) === 'translation-model' &&
	selectedValue(animation) === 'typewriter' &&
	selectedValue(reasoningEffort) === '__custom__' &&
	customReasoningEffort.value === 'balanced-fast' &&
	requestsPerMinute.value === '120' &&
	tokensPerMinute.value === '500000',
	'切换 URL 时 Key、模型、Prompt、温度、思考等级、RPM、TPM 和动画必须整套切换',
);
form.destroy();
assert(!host.firstElementChild, '翻译设置销毁后必须清理唯一 panel host');
