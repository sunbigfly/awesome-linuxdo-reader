import { Signal } from '../kernel/signal.js';

export const READER_TRANSLATION_CONFIG_STORAGE_KEY =
	'awesome-linuxdo-reader:translation:v1';
export const READER_AI_MODEL_METADATA_CACHE_STORAGE_KEY =
	'awesome-linuxdo-reader:ai-model-metadata:v1';
export const READER_AI_MODEL_METADATA_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

export const DEFAULT_READER_AI_TRANSLATION_PROMPT =
	'把用户正文自然、准确地翻译为简体中文，保留原意、语气和段落关系；' +
	'所有形如 ⟦数字⟧ 的占位符必须原样保留且只出现一次，不要添加解释。';
export const DEFAULT_READER_AI_TRANSLATION_TEMPERATURE = 0.1;
export const DEFAULT_READER_AI_REASONING_EFFORT = 'none';
export const DEFAULT_READER_AI_REQUESTS_PER_MINUTE = 0;
export const DEFAULT_READER_AI_TOKENS_PER_MINUTE = 0;
export const DEFAULT_READER_TRANSLATION_ANIMATION = 'fade';
export const READER_TRANSLATION_ANIMATIONS = Object.freeze([
	'fade',
	'blur',
	'typewriter',
	'shimmer',
	'spring',
	'none',
] as const);
export type ReaderTranslationAnimation =
	(typeof READER_TRANSLATION_ANIMATIONS)[number];
export const READER_AI_REASONING_EFFORT_PRESETS = Object.freeze([
	'',
	'none',
	'minimal',
	'low',
	'medium',
	'high',
	'xhigh',
	'max',
] as const);

export interface ReaderTranslationProfile {
	readonly baseUrl: string;
	readonly apiKey: string;
	/** 由当前服务 /models 返回并按 URL 持久化的可用模型目录。 */
	readonly models: readonly string[];
	/** 可选的 OpenRouter 风格模型元数据；普通兼容服务至少保留 id。 */
	readonly modelCatalog: readonly ReaderAiModelCatalogEntry[];
	/** 正文翻译业务选择的模型；其他业务保存自己的选择。 */
	readonly model: string;
	readonly prompt: string;
	readonly temperature: number;
	/** 空字符串表示不发送 reasoning_effort，由服务自行决定。 */
	readonly reasoningEffort: string;
	/** 0 表示不限制；每个 URL + 模型独立计量。 */
	readonly requestsPerMinute: number;
	/** 0 表示不限制；按输入与预期译文长度估算。 */
	readonly tokensPerMinute: number;
	/** @deprecated 只用于旧数据与可移植配置兼容；运行态以顶层 animation 为准。 */
	readonly animation: ReaderTranslationAnimation;
}

export interface ReaderTranslationConfig {
	/** URL 是服务项身份；数组不设业务数量上限。 */
	readonly profiles: readonly ReaderTranslationProfile[];
	readonly activeBaseUrl: string;
	/** 译文动画是全局呈现偏好，不随 URL Profile 切换。 */
	readonly animation: ReaderTranslationAnimation;
}

export interface ReaderTranslationAccessConfig {
	readonly baseUrl: string;
	readonly apiKey: string;
}

export interface ReaderAiModelSelection {
	readonly baseUrl: string;
	readonly model: string;
}

export interface ReaderAiModelBenchmark {
	readonly name: string;
	readonly score: number;
	readonly metric: string;
	readonly version: string;
	readonly variant: string;
}

export interface ReaderAiModelCatalogEntry {
	readonly id: string;
	readonly canonicalId: string;
	readonly name: string;
	readonly family: string;
	readonly created: number;
	readonly releaseDate: string;
	readonly lastUpdated: string;
	readonly knowledgeCutoff: string;
	readonly ownedBy: string;
	readonly description: string;
	readonly contextLength: number;
	readonly inputTokenLimit: number;
	readonly maxCompletionTokens: number;
	readonly inputModalities: readonly string[];
	readonly outputModalities: readonly string[];
	readonly supportedParameters: readonly string[];
	readonly reasoningEfforts: readonly string[];
	readonly attachment: boolean | null;
	readonly reasoning: boolean | null;
	readonly toolCall: boolean | null;
	readonly structuredOutput: boolean | null;
	readonly temperatureControl: boolean | null;
	readonly openWeights: boolean | null;
	readonly promptPrice: string;
	readonly completionPrice: string;
	readonly pricingSource: string;
	readonly intelligenceScore: number;
	readonly codingScore: number;
	readonly agenticScore: number;
	readonly designArenaElo: number;
	readonly benchmarks: readonly ReaderAiModelBenchmark[];
	readonly metadataSources: readonly string[];
}

export interface ReaderAiModelGroup {
	readonly baseUrl: string;
	readonly models: readonly string[];
	readonly catalog: readonly ReaderAiModelCatalogEntry[];
}

export type ReaderAiModelKind =
	| 'text'
	| 'reasoning'
	| 'image'
	| 'embedding'
	| 'realtime'
	| 'audio'
	| 'moderation';

export interface ReaderAiModelKindGroup {
	readonly id: ReaderAiModelKind;
	readonly label: string;
	readonly models: readonly ReaderAiModelCatalogEntry[];
}

export interface ReaderTranslationConfigStoragePort {
	getValue(key: string): unknown | Promise<unknown>;
	setValue(key: string, value: unknown): void | Promise<void>;
}

export interface ReaderTranslationConfigSnapshot {
	readonly loaded: boolean;
	readonly config: ReaderTranslationConfig;
}

export interface ReaderTranslationConfigRepositoryOptions {
	readonly storage: ReaderTranslationConfigStoragePort;
	readonly storageKey?: string;
	readonly metadataCacheStorageKey?: string;
}

export interface ReaderAiModelMetadataCache {
	readonly fetchedAt: number;
	readonly catalog: readonly ReaderAiModelCatalogEntry[];
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>>
		: null;
}

function normalizedCatalogStringList(value: unknown): readonly string[] {
	return Object.freeze([...new Set((Array.isArray(value) ? value : [])
		.map((entry) => String(entry ?? '').trim().slice(0, 64))
		.filter(Boolean))].slice(0, 64));
}

function normalizedCatalogNumber(value: unknown, maximum: number): number {
	const numeric = Number(value);
	return Number.isFinite(numeric) && numeric > 0
		? Math.min(maximum, numeric)
		: 0;
}

function normalizedCatalogPrice(value: unknown): string {
	const price = String(value ?? '').trim();
	return /^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/iu.test(price)
		? price.slice(0, 64)
		: '';
}

function normalizedCatalogBoolean(value: unknown): boolean | null {
	return typeof value === 'boolean' ? value : null;
}

function normalizedCatalogDate(value: unknown): string {
	const date = String(value ?? '').trim();
	return /^\d{4}-\d{2}(?:-\d{2})?$/u.test(date) ? date : '';
}

function catalogDateTimestamp(value: string): number {
	if (!value) return 0;
	const timestamp = Date.parse(`${value.length === 7 ? `${value}-01` : value}T00:00:00Z`);
	return Number.isFinite(timestamp) ? Math.floor(timestamp / 1_000) : 0;
}

function normalizedCatalogBenchmarks(value: unknown): readonly ReaderAiModelBenchmark[] {
	const byName = new Map<string, ReaderAiModelBenchmark>();
	for (const candidate of Array.isArray(value) ? value : []) {
		const item = record(candidate);
		const name = String(item?.name ?? '').trim().slice(0, 160);
		const score = normalizedCatalogNumber(item?.score, 100_000);
		if (!name || !score) continue;
		byName.set(name.toLocaleLowerCase(), Object.freeze({
			name,
			score,
			metric: String(item?.metric ?? '').trim().slice(0, 80),
			version: String(item?.version ?? '').trim().slice(0, 40),
			variant: String(item?.variant ?? '').trim().slice(0, 80),
		}));
		if (byName.size >= 24) break;
	}
	return Object.freeze([...byName.values()]);
}

function benchmarkScore(
	benchmarks: readonly ReaderAiModelBenchmark[],
	pattern: RegExp,
): number {
	return benchmarks.find((entry) => pattern.test(entry.name))?.score ?? 0;
}

function normalizedReasoningEfforts(source: Readonly<Record<string, unknown>>): readonly string[] {
	const reasoning = record(source.reasoning);
	const explicit = source.reasoningEfforts ?? source.reasoning_efforts ??
		reasoning?.supportedEfforts ?? reasoning?.supported_efforts;
	const values = [...(Array.isArray(explicit) ? explicit : [])];
	for (const option of Array.isArray(source.reasoningOptions)
		? source.reasoningOptions
		: Array.isArray(source.reasoning_options)
			? source.reasoning_options
			: []) {
		const candidate = record(option)?.values;
		if (Array.isArray(candidate)) values.push(...candidate);
	}
	return normalizedCatalogStringList(values);
}

function normalizedSupportedParameters(
	source: Readonly<Record<string, unknown>>,
): readonly string[] {
	const explicit = normalizedCatalogStringList(
		source.supportedParameters ?? source.supported_parameters,
	);
	const inferred = [
		normalizedCatalogBoolean(source.attachment) === true ? 'attachments' : '',
		normalizedCatalogBoolean(source.reasoning) === true ? 'reasoning' : '',
		normalizedCatalogBoolean(source.toolCall ?? source.tool_call) === true
			? 'tools'
			: '',
		normalizedCatalogBoolean(
			source.structuredOutput ?? source.structured_output,
		) === true ? 'structured_outputs' : '',
		normalizedCatalogBoolean(
			source.temperatureControl ?? source.temperature,
		) === true ? 'temperature' : '',
	].filter(Boolean);
	return normalizedCatalogStringList([...explicit, ...inferred]);
}

export function normalizeReaderAiModelCatalogEntry(
	value: unknown,
): ReaderAiModelCatalogEntry | null {
	const source = record(value);
	if (!source) return null;
	const id = String(source.id ?? '').trim().slice(0, 160);
	if (!id) return null;
	const architecture = record(source.architecture);
	const pricing = record(source.pricing);
	const topProvider = record(source.topProvider ?? source.top_provider);
	const limits = record(source.limit ?? source.limits);
	const modalities = record(source.modalities);
	const benchmarkList = normalizedCatalogBenchmarks(source.benchmarks);
	const benchmarks = record(source.benchmarks);
	const artificialAnalysis = record(
		benchmarks?.artificialAnalysis ?? benchmarks?.artificial_analysis,
	);
	const designArena = Array.isArray(benchmarks?.designArena)
		? benchmarks.designArena
		: Array.isArray(benchmarks?.design_arena)
			? benchmarks.design_arena
			: [];
	const designArenaElo = designArena.reduce((maximum, entry) => Math.max(
		maximum,
		normalizedCatalogNumber(record(entry)?.elo, 100_000),
	), 0);
	const releaseDate = normalizedCatalogDate(
		source.releaseDate ?? source.release_date,
	);
	const metadataSources = normalizedCatalogStringList(
		source.metadataSources ?? source.metadata_sources ?? ['provider'],
	);
	const promptPrice = normalizedCatalogPrice(
		source.promptPrice ?? source.prompt_price ?? pricing?.prompt,
	);
	const completionPrice = normalizedCatalogPrice(
		source.completionPrice ?? source.completion_price ?? pricing?.completion,
	);
	const supportedParameters = normalizedSupportedParameters(source);
	const inputModalities = normalizedCatalogStringList(
		source.inputModalities ?? source.input_modalities ??
			modalities?.input ??
			architecture?.inputModalities ?? architecture?.input_modalities,
	);
	const capability = (
		value: unknown,
		parameter: string,
	): boolean | null => normalizedCatalogBoolean(value) ??
		(supportedParameters.includes(parameter) ? true : null);
	return Object.freeze({
		id,
		canonicalId: String(
			source.canonicalId ?? source.canonical_id ?? source.canonical_slug ?? id,
		).trim().slice(0, 200) || id,
		name: String(source.name ?? '').trim().slice(0, 160),
		family: String(source.family ?? '').trim().slice(0, 120),
		created: normalizedCatalogNumber(source.created, 10_000_000_000) ||
			catalogDateTimestamp(releaseDate),
		releaseDate,
		lastUpdated: normalizedCatalogDate(
			source.lastUpdated ?? source.last_updated,
		),
		knowledgeCutoff: normalizedCatalogDate(
			source.knowledgeCutoff ?? source.knowledge_cutoff ?? source.knowledge,
		),
		ownedBy: String(source.ownedBy ?? source.owned_by ?? '')
			.trim().slice(0, 160),
		description: String(source.description ?? '').trim().slice(0, 1_000),
		contextLength: normalizedCatalogNumber(
			source.contextLength ?? source.context_length ??
				limits?.context ??
				topProvider?.contextLength ?? topProvider?.context_length,
			1_000_000_000,
		),
		inputTokenLimit: normalizedCatalogNumber(
			source.inputTokenLimit ?? source.input_token_limit ?? limits?.input,
			1_000_000_000,
		),
		maxCompletionTokens: normalizedCatalogNumber(
			source.maxCompletionTokens ?? source.max_completion_tokens ??
				limits?.output ??
				topProvider?.maxCompletionTokens ?? topProvider?.max_completion_tokens,
			1_000_000_000,
		),
		inputModalities,
		outputModalities: normalizedCatalogStringList(
			source.outputModalities ?? source.output_modalities ??
				modalities?.output ??
				architecture?.outputModalities ?? architecture?.output_modalities,
		),
		supportedParameters,
		reasoningEfforts: normalizedReasoningEfforts(source),
		attachment: normalizedCatalogBoolean(source.attachment) ??
			(inputModalities.some((value) => ['file', 'pdf'].includes(value))
				? true
				: null),
		reasoning: capability(source.reasoning, 'reasoning'),
		toolCall: capability(source.toolCall ?? source.tool_call, 'tools'),
		structuredOutput: capability(
			source.structuredOutput ?? source.structured_output,
			'structured_outputs',
		),
		temperatureControl: capability(
			source.temperatureControl ?? source.temperature,
			'temperature',
		),
		openWeights: normalizedCatalogBoolean(
			source.openWeights ?? source.open_weights,
		),
		promptPrice,
		completionPrice,
		pricingSource: String(source.pricingSource ?? source.pricing_source ??
			(promptPrice || completionPrice ? metadataSources[0] ?? '' : ''))
			.trim().slice(0, 64),
		intelligenceScore: normalizedCatalogNumber(
			source.intelligenceScore ?? source.intelligence_score ??
				artificialAnalysis?.intelligenceIndex ??
				artificialAnalysis?.intelligence_index ??
				benchmarkScore(benchmarkList, /artificial analysis intelligence/iu),
			100_000,
		),
		codingScore: normalizedCatalogNumber(
			source.codingScore ?? source.coding_score ??
				artificialAnalysis?.codingIndex ?? artificialAnalysis?.coding_index ??
				benchmarkScore(benchmarkList, /artificial analysis coding/iu),
			100_000,
		),
		agenticScore: normalizedCatalogNumber(
			source.agenticScore ?? source.agentic_score ??
				artificialAnalysis?.agenticIndex ?? artificialAnalysis?.agentic_index ??
				benchmarkScore(benchmarkList, /artificial analysis agentic/iu),
			100_000,
		),
		designArenaElo,
		benchmarks: benchmarkList,
		metadataSources,
	});
}

/** 保留当前供应商事实，只用精确匹配的公共目录填补空字段。 */
export function mergeReaderAiModelCatalogEntries(
	primary: ReaderAiModelCatalogEntry,
	enrichment: ReaderAiModelCatalogEntry,
	preservePrimaryArrays = false,
): ReaderAiModelCatalogEntry {
	const primaryName = primary.name && primary.name !== primary.id
		? primary.name
		: '';
	const promptPrice = primary.promptPrice || enrichment.promptPrice;
	const completionPrice = primary.completionPrice || enrichment.completionPrice;
	return normalizeReaderAiModelCatalogEntry({
		id: primary.id,
		canonicalId: enrichment.canonicalId || primary.canonicalId,
		name: primaryName || enrichment.name || primary.name,
		family: primary.family || enrichment.family,
		created: primary.created || enrichment.created,
		releaseDate: enrichment.releaseDate || primary.releaseDate,
		lastUpdated: enrichment.lastUpdated || primary.lastUpdated,
		knowledgeCutoff: enrichment.knowledgeCutoff || primary.knowledgeCutoff,
		ownedBy: primary.ownedBy || enrichment.ownedBy ||
			enrichment.canonicalId.split('/')[0] || '',
		description: primary.description || enrichment.description,
		contextLength: primary.contextLength || enrichment.contextLength,
		inputTokenLimit: primary.inputTokenLimit || enrichment.inputTokenLimit,
		maxCompletionTokens: primary.maxCompletionTokens ||
			enrichment.maxCompletionTokens,
		inputModalities: preservePrimaryArrays && primary.inputModalities.length
			? primary.inputModalities
			: [...new Set([
				...primary.inputModalities,
				...enrichment.inputModalities,
			])],
		outputModalities: preservePrimaryArrays && primary.outputModalities.length
			? primary.outputModalities
			: [...new Set([
				...primary.outputModalities,
				...enrichment.outputModalities,
			])],
		supportedParameters:
			preservePrimaryArrays && primary.supportedParameters.length
				? primary.supportedParameters
				: [...new Set([
					...primary.supportedParameters,
					...enrichment.supportedParameters,
				])],
		reasoningEfforts: preservePrimaryArrays && primary.reasoningEfforts.length
			? primary.reasoningEfforts
			: [...new Set([
				...primary.reasoningEfforts,
				...enrichment.reasoningEfforts,
			])],
		attachment: primary.attachment ?? enrichment.attachment,
		reasoning: primary.reasoning ?? enrichment.reasoning,
		toolCall: primary.toolCall ?? enrichment.toolCall,
		structuredOutput: primary.structuredOutput ?? enrichment.structuredOutput,
		temperatureControl: primary.temperatureControl ??
			enrichment.temperatureControl,
		openWeights: primary.openWeights ?? enrichment.openWeights,
		promptPrice,
		completionPrice,
		pricingSource: primary.promptPrice || primary.completionPrice
			? primary.pricingSource || 'provider'
			: enrichment.pricingSource,
		intelligenceScore: primary.intelligenceScore ||
			enrichment.intelligenceScore,
		codingScore: primary.codingScore || enrichment.codingScore,
		agenticScore: primary.agenticScore || enrichment.agenticScore,
		designArenaElo: primary.designArenaElo || enrichment.designArenaElo,
		benchmarks: preservePrimaryArrays && primary.benchmarks.length
			? primary.benchmarks
			: [...new Map([
				...primary.benchmarks,
				...enrichment.benchmarks,
			].map((entry) => [entry.name.toLocaleLowerCase(), entry] as const)).values()],
		metadataSources: [...new Set([
			...primary.metadataSources,
			...enrichment.metadataSources,
		])],
	})!;
}

/** 仅按规范 ID、提供方/ID 或唯一完整后缀命中，不对私有别名做模糊猜测。 */
export function findReaderAiModelCatalogExactMatch(
	entry: ReaderAiModelCatalogEntry,
	catalog: Iterable<ReaderAiModelCatalogEntry>,
): ReaderAiModelCatalogEntry | null {
	const candidates = new Set([
		entry.id,
		entry.canonicalId,
		entry.ownedBy && !entry.id.includes('/')
			? `${entry.ownedBy.toLocaleLowerCase()}/${entry.id}`
			: '',
	].map((value) => value.trim().toLocaleLowerCase()).filter(Boolean));
	const suffix = entry.id.includes('/')
		? ''
		: `/${entry.id.toLocaleLowerCase()}`;
	let suffixMatch: ReaderAiModelCatalogEntry | null = null;
	for (const candidate of catalog) {
		const key = candidate.id.trim().toLocaleLowerCase();
		if (candidates.has(key)) return candidate;
		if (!suffix || !key.endsWith(suffix)) continue;
		if (suffixMatch) return null;
		suffixMatch = candidate;
	}
	return suffixMatch;
}

export function normalizeReaderTranslationBaseUrl(value: unknown): string {
	try {
		const source = String(value ?? '').trim();
		if (!source) return '';
		const url = new URL(source);
		const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
		if (
			(url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
			url.username ||
			url.password ||
			url.search ||
			url.hash
		) return '';
		url.pathname = `${url.pathname.replace(/\/+$/g, '') || '/v1'}/`;
		return url.href;
	} catch {
		return '';
	}
}

export function createReaderTranslationDefaultProfile(): ReaderTranslationProfile {
	return Object.freeze({
		baseUrl: 'https://api.openai.com/v1/',
		apiKey: '',
		models: Object.freeze([]),
		modelCatalog: Object.freeze([]),
		model: '',
		prompt: DEFAULT_READER_AI_TRANSLATION_PROMPT,
		temperature: DEFAULT_READER_AI_TRANSLATION_TEMPERATURE,
		reasoningEffort: DEFAULT_READER_AI_REASONING_EFFORT,
		requestsPerMinute: DEFAULT_READER_AI_REQUESTS_PER_MINUTE,
		tokensPerMinute: DEFAULT_READER_AI_TOKENS_PER_MINUTE,
		animation: DEFAULT_READER_TRANSLATION_ANIMATION,
	});
}

export function createReaderTranslationDefaultConfig(): ReaderTranslationConfig {
	const profile = createReaderTranslationDefaultProfile();
	return Object.freeze({
		profiles: Object.freeze([profile]),
		activeBaseUrl: profile.baseUrl,
		animation: DEFAULT_READER_TRANSLATION_ANIMATION,
	});
}

export function normalizeReaderTranslationTemperature(value: unknown): number {
	const temperature = Number(value);
	if (!Number.isFinite(temperature)) {
		return DEFAULT_READER_AI_TRANSLATION_TEMPERATURE;
	}
	return Math.round(Math.min(1, Math.max(0, temperature)) * 10) / 10;
}

export function normalizeReaderTranslationReasoningEffort(value: unknown): string {
	return String(value ?? DEFAULT_READER_AI_REASONING_EFFORT).trim().slice(0, 64);
}

export function normalizeReaderTranslationRateLimit(
	value: unknown,
	maximum: number,
): number {
	const normalized = Math.floor(Number(value));
	return Number.isSafeInteger(normalized) && normalized > 0
		? Math.min(maximum, normalized)
		: 0;
}

export function normalizeReaderTranslationAnimation(
	value: unknown,
): ReaderTranslationAnimation {
	const animation = String(value ?? '');
	return READER_TRANSLATION_ANIMATIONS.includes(
		animation as ReaderTranslationAnimation,
	)
		? animation as ReaderTranslationAnimation
		: DEFAULT_READER_TRANSLATION_ANIMATION;
}

export function normalizeReaderTranslationProfile(
	value: unknown,
): ReaderTranslationProfile | null {
	const source = record(value);
	if (!source) return null;
	const defaults = createReaderTranslationDefaultProfile();
	const baseUrl = normalizeReaderTranslationBaseUrl(source.baseUrl);
	if (!baseUrl) return null;
	const model = String(source.model ?? '').trim().slice(0, 160);
	const rawModels = [...new Set([
		...(Array.isArray(source.models) ? source.models : []),
		model,
	].map((entry) => String(entry ?? '').trim().slice(0, 160)).filter(Boolean))]
		.sort((left, right) => left.localeCompare(right))
		.slice(0, 1_000);
	const catalogById = new Map<string, ReaderAiModelCatalogEntry>();
	for (const candidate of Array.isArray(source.modelCatalog)
		? source.modelCatalog
		: []) {
		const entry = normalizeReaderAiModelCatalogEntry(candidate);
		if (entry) catalogById.set(entry.id, entry);
	}
	for (const id of rawModels) {
		if (!catalogById.has(id)) {
			const entry = normalizeReaderAiModelCatalogEntry({ id });
			if (entry) catalogById.set(id, entry);
		}
	}
	const modelCatalog = Object.freeze([...catalogById.values()]
		.sort((left, right) => left.id.localeCompare(right.id))
		.slice(0, 1_000));
	const models = Object.freeze(modelCatalog.map((entry) => entry.id));
	return Object.freeze({
		baseUrl,
		apiKey: String(source.apiKey ?? '').trim().slice(0, 4096),
		models,
		modelCatalog,
		model,
		prompt: String(source.prompt ?? defaults.prompt).trim().slice(0, 4000) ||
			defaults.prompt,
		temperature: normalizeReaderTranslationTemperature(source.temperature),
		reasoningEffort: normalizeReaderTranslationReasoningEffort(
			source.reasoningEffort,
		),
		requestsPerMinute: normalizeReaderTranslationRateLimit(
			source.requestsPerMinute,
			10_000,
		),
		tokensPerMinute: normalizeReaderTranslationRateLimit(
			source.tokensPerMinute,
			100_000_000,
		),
		animation: normalizeReaderTranslationAnimation(source.animation),
	});
}

export function normalizeReaderTranslationConfig(
	value: unknown,
): ReaderTranslationConfig {
	const source = record(value);
	const defaults = createReaderTranslationDefaultConfig();
	const candidates = Array.isArray(source?.profiles)
		? source.profiles
		: source
			? [source]
			: [];
	const byUrl = new Map<string, ReaderTranslationProfile>();
	for (const candidate of candidates) {
		const candidateRecord = record(candidate);
		const profile = normalizeReaderTranslationProfile(candidateRecord
			? {
				...candidateRecord,
				animation: candidateRecord.animation ?? source?.animation,
			}
			: candidate);
		if (profile) byUrl.set(profile.baseUrl, profile);
	}
	const normalizedProfiles = byUrl.size
		? [...byUrl.values()]
		: [...defaults.profiles];
	const requestedActive = normalizeReaderTranslationBaseUrl(
		source?.activeBaseUrl ?? source?.baseUrl,
	);
	const activeBaseUrl = normalizedProfiles.some((profile) =>
		profile.baseUrl === requestedActive)
		? requestedActive
		: normalizedProfiles[0]!.baseUrl;
	const legacyActiveAnimation = normalizedProfiles.find((profile) =>
		profile.baseUrl === activeBaseUrl)?.animation;
	const animation = normalizeReaderTranslationAnimation(
		Object.hasOwn(source ?? {}, 'animation')
			? source?.animation
			: legacyActiveAnimation,
	);
	const profiles = Object.freeze(normalizedProfiles.map((profile) =>
		profile.animation === animation
			? profile
			: Object.freeze({ ...profile, animation })));
	return Object.freeze({
		profiles,
		activeBaseUrl,
		animation,
	});
}

export function readerTranslationActiveProfile(
	value: ReaderTranslationConfig,
): ReaderTranslationProfile {
	return value.profiles.find((profile) =>
		profile.baseUrl === value.activeBaseUrl) ??
		value.profiles[0] ??
		createReaderTranslationDefaultProfile();
}

const readerAiModelKinds = Object.freeze([
	Object.freeze({ id: 'text', label: '文本 / 多模态' }),
	Object.freeze({ id: 'reasoning', label: '推理模型' }),
	Object.freeze({ id: 'image', label: '图像生成' }),
	Object.freeze({ id: 'embedding', label: '嵌入模型' }),
	Object.freeze({ id: 'realtime', label: '实时模型' }),
	Object.freeze({ id: 'audio', label: '音频 / 语音' }),
	Object.freeze({ id: 'moderation', label: '审核 / 安全' }),
] as const);

export function readerAiModelKind(
	entry: ReaderAiModelCatalogEntry,
): ReaderAiModelKind {
	const id = entry.id.toLocaleLowerCase();
	const outputs = new Set(entry.outputModalities.map((value) =>
		value.toLocaleLowerCase()));
	if (/moderation|guard|safety/u.test(id)) return 'moderation';
	if (/realtime/u.test(id)) return 'realtime';
	if (outputs.has('embeddings') || /embedding|embed/u.test(id)) {
		return 'embedding';
	}
	if (outputs.has('image') || /image|dall[·-]?e|flux|imagen/u.test(id)) {
		return 'image';
	}
	if (
		['audio', 'speech', 'transcription'].some((value) => outputs.has(value)) ||
		/audio|transcri|whisper|tts|speech/u.test(id)
	) return 'audio';
	if (
		entry.supportedParameters.includes('reasoning') ||
		/^(?:o\d|r\d)(?:-|$)|reason|deepseek-r/u.test(id)
	) return 'reasoning';
	return 'text';
}

function readerAiModelVersion(entry: ReaderAiModelCatalogEntry): readonly number[] {
	return Object.freeze([...entry.id.matchAll(/\d+(?:\.\d+)?/g)]
		.map((match) => Number(match[0])));
}

function readerAiModelTier(entry: ReaderAiModelCatalogEntry): number {
	const id = entry.id.toLocaleLowerCase();
	if (/(?:^|[-_.])(ultra|max|pro)(?:$|[-_.])/u.test(id)) return 70;
	if (/(?:^|[-_.])(sol|large)(?:$|[-_.])/u.test(id)) return 60;
	if (/(?:^|[-_.])terra(?:$|[-_.])/u.test(id)) return 45;
	if (/(?:^|[-_.])(mini|medium)(?:$|[-_.])/u.test(id)) return 35;
	if (/(?:^|[-_.])(luna|small)(?:$|[-_.])/u.test(id)) return 25;
	if (/(?:^|[-_.])(nano|lite)(?:$|[-_.])/u.test(id)) return 15;
	return 50;
}

export function compareReaderAiModels(
	left: ReaderAiModelCatalogEntry,
	right: ReaderAiModelCatalogEntry,
): number {
	for (const score of ['intelligenceScore', 'designArenaElo'] as const) {
		const difference = right[score] - left[score];
		if (difference) return difference;
	}
	if (right.contextLength !== left.contextLength) {
		return right.contextLength - left.contextLength;
	}
	if (right.created !== left.created) return right.created - left.created;
	const leftVersion = readerAiModelVersion(left);
	const rightVersion = readerAiModelVersion(right);
	for (let index = 0; index < Math.max(
		leftVersion.length,
		rightVersion.length,
	); index += 1) {
		const difference = (rightVersion[index] ?? 0) - (leftVersion[index] ?? 0);
		if (difference) return difference;
	}
	const tierDifference = readerAiModelTier(right) - readerAiModelTier(left);
	if (tierDifference) return tierDifference;
	return left.id.localeCompare(right.id, 'en', {
		numeric: true,
		sensitivity: 'base',
	});
}

function compactReaderAiTokenCount(value: number): string {
	if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
	if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`;
	return String(value);
}

export function readerAiModelDisplayLabel(
	entry: ReaderAiModelCatalogEntry,
): string {
	const label = readerAiModelIdentityLabel(entry);
	const metadata = [
		entry.intelligenceScore
			? `基准 ${Number(entry.intelligenceScore.toFixed(1))}`
			: '',
		entry.contextLength
			? `上下文 ${compactReaderAiTokenCount(entry.contextLength)}`
			: '',
	].filter(Boolean);
	return metadata.length ? `${label} · ${metadata.join(' · ')}` : label;
}

export function readerAiModelIdentityLabel(
	entry: ReaderAiModelCatalogEntry,
): string {
	const name = entry.name.trim();
	if (!name) return entry.id;
	const identity = (value: string): string => value
		.normalize('NFKC')
		.toLocaleLowerCase()
		.replace(/[^\p{Letter}\p{Number}]+/gu, '');
	return identity(name) === identity(entry.id)
		? name
		: `${name} (${entry.id})`;
}

export function readerAiModelKindGroups(
	models: readonly ReaderAiModelCatalogEntry[],
): readonly ReaderAiModelKindGroup[] {
	return Object.freeze(readerAiModelKinds.map((kind) => Object.freeze({
		...kind,
		models: Object.freeze(models
			.filter((entry) => readerAiModelKind(entry) === kind.id)
			.sort(compareReaderAiModels)),
	})).filter((group) => group.models.length));
}

export function readerAiModelGroups(
	value: ReaderTranslationConfig,
): readonly ReaderAiModelGroup[] {
	return Object.freeze(value.profiles
		.filter((profile) => profile.apiKey.trim() && profile.models.length)
		.map((profile) => Object.freeze({
			baseUrl: profile.baseUrl,
			models: profile.models,
			catalog: profile.modelCatalog,
		})));
}

export function readerAiProfileForSelection(
	value: ReaderTranslationConfig,
	selection: ReaderAiModelSelection,
): ReaderTranslationProfile | null {
	const baseUrl = normalizeReaderTranslationBaseUrl(selection.baseUrl);
	const model = String(selection.model ?? '').trim();
	const profile = value.profiles.find((entry) => entry.baseUrl === baseUrl);
	return profile?.apiKey.trim() && profile.models.includes(model)
		? profile
		: null;
}

export function validateReaderTranslationAccessConfig(
	value: ReaderTranslationAccessConfig,
): readonly string[] {
	const issues: string[] = [];
	if (!normalizeReaderTranslationBaseUrl(value.baseUrl)) {
		issues.push('API URL 必须是 HTTPS，或本机 localhost/127.0.0.1 的 HTTP 地址');
	}
	if (!value.apiKey.trim()) issues.push('请先填写 API Key');
	return Object.freeze(issues);
}

export function validateReaderTranslationConfig(
	value: ReaderTranslationConfig,
): readonly string[] {
	const issues: string[] = [];
	if (!value.profiles.length) issues.push('至少保留一个 AI 服务 URL');
	if (!value.profiles.some((profile) =>
		profile.baseUrl === value.activeBaseUrl)) {
		issues.push('当前 AI 服务 URL 不在服务集合中');
	}
	if (normalizeReaderTranslationAnimation(value.animation) !== value.animation) {
		issues.push('译文动画配置无效');
	}
	const seen = new Set<string>();
	for (const profile of value.profiles) {
		if (seen.has(profile.baseUrl)) issues.push('AI 服务 URL 不能重复');
		seen.add(profile.baseUrl);
		if (profile.animation !== value.animation) {
			issues.push('译文动画必须作为全局偏好保持一致');
		}
		issues.push(...validateReaderTranslationProfile(profile));
	}
	return Object.freeze(issues);
}

export function validateReaderTranslationProfile(
	value: ReaderTranslationProfile,
): readonly string[] {
	const issues: string[] = [];
	if (!normalizeReaderTranslationBaseUrl(value.baseUrl)) {
		issues.push('API URL 必须是 HTTPS，或本机 localhost/127.0.0.1 的 HTTP 地址');
	}
	if (value.model.trim() && !value.models.includes(value.model.trim())) {
		issues.push('翻译模型不在当前服务已缓存的模型目录中');
	}
	if (!value.prompt.trim()) issues.push('翻译 Prompt 不能为空');
	if (
		!Number.isFinite(value.temperature) ||
		value.temperature < 0 ||
		value.temperature > 1
	) issues.push('翻译温度必须在 0–1 之间');
	if (
		value.reasoningEffort.length > 64 ||
		/[\u0000-\u001f\u007f]/.test(value.reasoningEffort)
	) issues.push('思考等级不能超过 64 个字符或包含控制字符');
	if (
		!Number.isSafeInteger(value.requestsPerMinute) ||
		value.requestsPerMinute < 0 ||
		value.requestsPerMinute > 10_000
	) issues.push('RPM 必须是 0–10000 的整数');
	if (
		!Number.isSafeInteger(value.tokensPerMinute) ||
		value.tokensPerMinute < 0 ||
		value.tokensPerMinute > 100_000_000
	) issues.push('TPM 必须是 0–100000000 的整数');
	return Object.freeze(issues);
}

export function readerTranslationUsesAi(value: ReaderTranslationConfig): boolean {
	const profile = readerTranslationActiveProfile(value);
	return Boolean(
		profile.apiKey.trim() &&
		profile.model.trim() &&
		profile.models.includes(profile.model.trim()) &&
		normalizeReaderTranslationBaseUrl(profile.baseUrl),
	);
}

export function normalizeReaderAiModelMetadataCache(
	value: unknown,
): ReaderAiModelMetadataCache | null {
	const source = record(value);
	const fetchedAt = Math.floor(Number(source?.fetchedAt ?? source?.fetched_at));
	if (!Number.isSafeInteger(fetchedAt) || fetchedAt <= 0) return null;
	const byId = new Map<string, ReaderAiModelCatalogEntry>();
	for (const candidate of Array.isArray(source?.catalog) ? source.catalog : []) {
		const entry = normalizeReaderAiModelCatalogEntry(candidate);
		if (entry) byId.set(entry.id, entry);
		if (byId.size >= 5_000) break;
	}
	if (!byId.size) return null;
	return Object.freeze({
		fetchedAt,
		catalog: Object.freeze([...byId.values()]
			.sort((left, right) => left.id.localeCompare(right.id))),
	});
}

/** 共用 AI 服务与高级翻译参数的兼容存储 owner；storage key 保持不变。 */
export class ReaderTranslationConfigRepository {
	readonly changes = new Signal<ReaderTranslationConfigSnapshot>();
	readonly #storage: ReaderTranslationConfigStoragePort;
	readonly #storageKey: string;
	readonly #metadataCacheStorageKey: string;
	#snapshot: ReaderTranslationConfigSnapshot = Object.freeze({
		loaded: false,
		config: createReaderTranslationDefaultConfig(),
	});
	#loadPromise: Promise<ReaderTranslationConfigSnapshot> | null = null;
	#writeTail: Promise<void> = Promise.resolve();

	constructor(options: ReaderTranslationConfigRepositoryOptions) {
		this.#storage = options.storage;
		this.#storageKey = options.storageKey ?? READER_TRANSLATION_CONFIG_STORAGE_KEY;
		this.#metadataCacheStorageKey = options.metadataCacheStorageKey ??
			READER_AI_MODEL_METADATA_CACHE_STORAGE_KEY;
	}

	get snapshot(): ReaderTranslationConfigSnapshot {
		return this.#snapshot;
	}

	async load(): Promise<ReaderTranslationConfigSnapshot> {
		if (this.#snapshot.loaded) return this.#snapshot;
		if (this.#loadPromise) return this.#loadPromise;
		this.#loadPromise = (async () => {
			const source = record(await this.#storage.getValue(this.#storageKey));
			this.#snapshot = Object.freeze({
				loaded: true,
				config: normalizeReaderTranslationConfig(source?.config ?? source),
			});
			this.changes.emit(this.#snapshot);
			return this.#snapshot;
		})();
		try {
			return await this.#loadPromise;
		} finally {
			this.#loadPromise = null;
		}
	}

	async saveConfig(
		value: ReaderTranslationConfig,
	): Promise<ReaderTranslationConfigSnapshot> {
		await this.load();
		const snapshot = Object.freeze({
			loaded: true,
			config: normalizeReaderTranslationConfig(value),
		});
		const write = this.#writeTail.then(async () => {
			await this.#storage.setValue(
				this.#storageKey,
				{ version: 5, config: snapshot.config },
			);
			this.#snapshot = snapshot;
			this.changes.emit(snapshot);
		});
		this.#writeTail = write.catch(() => {});
		await write;
		return snapshot;
	}

	async loadModelMetadataCache(): Promise<ReaderAiModelMetadataCache | null> {
		return normalizeReaderAiModelMetadataCache(
			await this.#storage.getValue(this.#metadataCacheStorageKey),
		);
	}

	async saveModelMetadataCache(
		value: ReaderAiModelMetadataCache,
	): Promise<ReaderAiModelMetadataCache> {
		const normalized = normalizeReaderAiModelMetadataCache(value);
		if (!normalized) throw new Error('公共模型元数据缓存为空或无效');
		const write = this.#writeTail.then(() => this.#storage.setValue(
			this.#metadataCacheStorageKey,
			{ version: 1, ...normalized },
		));
		this.#writeTail = write.catch(() => {});
		await write;
		return normalized;
	}
}
