import { parseHTML } from 'linkedom';
import { ReaderTranslationSettingsForm } from
	'../src/settings/reader-translation-settings-form.js';
import {
	READER_TRANSLATION_CONFIG_STORAGE_KEY,
	ReaderTranslationConfigRepository,
	createReaderTranslationDefaultProfile,
	normalizeReaderTranslationConfig,
	readerTranslationActiveProfile,
	readerTranslationUsesAi,
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
let translationTheme: ReaderTranslationTheme = 'quote';
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
	presentation: {
		readTheme: () => translationTheme,
		persistTheme: (theme) => {
			translationTheme = theme;
		},
	},
});
await Promise.resolve();
assert(
	host.querySelectorAll('input[type="text"],input[type="password"]').length === 3 &&
	host.querySelectorAll('select').length === 5 &&
	host.querySelectorAll('textarea').length === 1 &&
	host.querySelector('input[aria-label="翻译温度"]') !== null &&
	host.querySelector('input[type="password"]') !== null &&
	host.textContent?.includes(
		'选择译文呈现，并配置公共翻译或 OpenAI 兼容服务',
	) &&
	host.textContent?.includes(
		'选择已有 AI 服务；新增后在下方填写 API URL',
	) &&
	host.textContent?.includes(
		'留空仍使用 Google / Microsoft 公共翻译',
	),
	'翻译设置主区必须提供译文样式、多 URL 集合、Key、服务端模型与译文动画，高级区保留温度、思考等级与 Prompt',
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
		'未启用 AI',
	'设置必须把服务集合与所选 URL 的完整配置拆成两个可辨认的嵌套分组，高级设置默认折叠',
);
const translationFooter = host.querySelector<HTMLElement>(
	'.ldp-translation-footer',
)!;
const translationStatus = host.querySelector<HTMLElement>(
	'.ldp-translation-status',
)!;
const translationActions = host.querySelector<HTMLElement>(
	'.ldp-translation-actions',
)!;
assert(
	translationFooter.firstElementChild === translationStatus &&
		translationFooter.lastElementChild === translationActions &&
		translationActions.querySelector(
			'button[aria-label="保存翻译设置"]',
		) !== null,
	'翻译设置状态必须在左，保存操作必须占据页脚右侧动作位',
);

const inputs = [...host.querySelectorAll<HTMLInputElement>('input')];
const baseUrl = inputs.find((input) => input.getAttribute('aria-label') === 'API URL')!;
const apiKey = inputs.find((input) => input.getAttribute('aria-label') === 'API Key')!;
const profileSelect = host.querySelector<HTMLSelectElement>(
	'select[aria-label="已保存 AI 翻译服务"]',
)!;
const model = host.querySelector<HTMLSelectElement>('select[aria-label="模型"]')!;
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
const customReasoningEffort = inputs.find((input) =>
	input.getAttribute('aria-label') === '自定义思考等级')!;
const requestsPerMinute = inputs.find((input) =>
	input.getAttribute('aria-label') === '每分钟请求数（RPM）')!;
const tokensPerMinute = inputs.find((input) =>
	input.getAttribute('aria-label') === '每分钟令牌数（TPM）')!;
const prompt = host.querySelector<HTMLTextAreaElement>('textarea')!;
assert(
	model.disabled && temperature.value === '0.1' &&
	[...theme.options].map((option) => option.value).join(',') ===
		'quote,plain,weakening,dividing-line,underline,highlight,paper' &&
	selectedValue(theme) === 'quote' &&
	[...animation.options].some((option) =>
		option.value === 'spring' && option.textContent === '弹性落字') &&
	[...animation.options].some((option) =>
		(option.selected || option.hasAttribute('selected')) &&
		option.value === 'fade') &&
	animation.closest('.ldp-translation-profile-group') === null &&
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
for (const option of theme.options) {
	option.toggleAttribute('selected', option.value === 'highlight');
}
theme.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
assert(
	translationTheme === 'highlight' &&
	host.textContent?.includes('译文样式已更新'),
	'译文样式必须独立于 API URL 保存并立即生效',
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
for (const option of animation.options) {
	option.toggleAttribute('selected', option.value === 'typewriter');
}
animation.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert(
	repository.snapshot.config.animation === 'typewriter' &&
	repository.snapshot.config.profiles.every((profile) =>
		profile.animation === 'typewriter') &&
	host.textContent?.includes('所有服务统一使用新动画'),
	'译文动画必须脱离 URL Profile 立即全局保存',
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
	repository.snapshot.config.animation === 'typewriter' &&
	host.querySelector('.ldp-translation-profile-state')?.textContent ===
		'AI 已配置' &&
	values.has(READER_TRANSLATION_CONFIG_STORAGE_KEY),
	'服务端模型选择、思考等级自定义值和折叠高级参数必须保存到独立用户脚本配置',
);

let newUrlInputFocusCount = 0;
const originalBaseUrlFocus = baseUrl.focus;
baseUrl.focus = () => {
	newUrlInputFocusCount += 1;
};
host.querySelector<HTMLButtonElement>('[aria-label="新增翻译 URL"]')!.click();
baseUrl.value = 'https://second.example/v1';
host.querySelector<HTMLButtonElement>('[aria-label="新增翻译 URL"]')!.click();
baseUrl.focus = originalBaseUrlFocus;
assert(
	newUrlInputFocusCount === 2 &&
	baseUrl.value === 'https://second.example/v1' &&
	selectedValue(profileSelect) === '__new__' &&
	[...profileSelect.options].some((option) =>
		option.value === '__new__' &&
		option.textContent === '正在新建服务（未保存）') &&
	host.querySelector<HTMLButtonElement>(
		'[aria-label="取消新增翻译 URL"]',
	)?.textContent?.includes('取消新增') &&
	host.querySelector('.ldp-translation-profile-state')?.textContent ===
		'新建草稿' &&
	host.querySelector('.ldp-translation-profile-group')?.textContent?.includes(
		'尚未填写 URL',
	),
	'新增服务必须聚焦下方 API URL、明确草稿与取消入口，重复点击不得清空输入',
);
host.querySelector<HTMLButtonElement>(
	'[aria-label="取消新增翻译 URL"]',
)!.click();
await Promise.resolve();
assert(
	selectedValue(profileSelect) === 'https://api.example.com/v1/' &&
		baseUrl.value === 'https://api.example.com/v1/' &&
	host.querySelector<HTMLButtonElement>(
		'[aria-label="删除当前翻译 URL"]',
	)?.textContent?.includes('删除服务'),
	'取消新增必须恢复当前已保存服务，并把草稿操作还原为删除服务',
);
host.querySelector<HTMLButtonElement>('[aria-label="新增翻译 URL"]')!.click();
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
	readerTranslationActiveProfile(repository.snapshot.config).animation ===
		'typewriter' &&
	repository.snapshot.config.animation === 'typewriter' &&
	readerTranslationActiveProfile(repository.snapshot.config).reasoningEffort === 'none' &&
	readerTranslationActiveProfile(repository.snapshot.config).requestsPerMinute === 0 &&
	readerTranslationActiveProfile(repository.snapshot.config).tokensPerMinute === 0,
	'用户必须能持续新增 URL 服务项，并在切换当前项时保留各 URL 对应的独立 Key：' +
		JSON.stringify(repository.snapshot.config) + ` text=${host.textContent}`,
);
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
	'切换 URL 时 Key、模型、Prompt、温度、思考等级、RPM 与 TPM 必须整套切换，全局动画必须保持',
);
form.destroy();
assert(!host.firstElementChild, '翻译设置销毁后必须清理唯一 panel host');
