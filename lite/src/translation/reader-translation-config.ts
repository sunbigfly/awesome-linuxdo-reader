import { Signal } from '../kernel/signal.js';

export const READER_TRANSLATION_CONFIG_STORAGE_KEY =
	'awesome-linuxdo-reader:translation:v1';

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
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>>
		: null;
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
	return Object.freeze({
		baseUrl,
		apiKey: String(source.apiKey ?? '').trim().slice(0, 4096),
		model: String(source.model ?? '').trim().slice(0, 160),
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
	if (!value.profiles.length) issues.push('至少保留一个翻译 URL');
	if (!value.profiles.some((profile) =>
		profile.baseUrl === value.activeBaseUrl)) {
		issues.push('当前翻译 URL 不在服务集合中');
	}
	if (normalizeReaderTranslationAnimation(value.animation) !== value.animation) {
		issues.push('译文动画配置无效');
	}
	const seen = new Set<string>();
	for (const profile of value.profiles) {
		if (seen.has(profile.baseUrl)) issues.push('翻译 URL 不能重复');
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
	if (value.apiKey.trim() && !value.model.trim()) {
		issues.push('请先从 /models 获取并选择模型');
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
		normalizeReaderTranslationBaseUrl(profile.baseUrl),
	);
}

/** AI URL、Key、模型与高级翻译参数的唯一脚本专属存储 owner。 */
export class ReaderTranslationConfigRepository {
	readonly changes = new Signal<ReaderTranslationConfigSnapshot>();
	readonly #storage: ReaderTranslationConfigStoragePort;
	readonly #storageKey: string;
	#snapshot: ReaderTranslationConfigSnapshot = Object.freeze({
		loaded: false,
		config: createReaderTranslationDefaultConfig(),
	});
	#loadPromise: Promise<ReaderTranslationConfigSnapshot> | null = null;
	#writeTail: Promise<void> = Promise.resolve();

	constructor(options: ReaderTranslationConfigRepositoryOptions) {
		this.#storage = options.storage;
		this.#storageKey = options.storageKey ?? READER_TRANSLATION_CONFIG_STORAGE_KEY;
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
		this.#snapshot = Object.freeze({
			loaded: true,
			config: normalizeReaderTranslationConfig(value),
		});
		const snapshot = this.#snapshot;
		const write = this.#writeTail.then(() => this.#storage.setValue(
			this.#storageKey,
			{ version: 3, config: snapshot.config },
		));
		this.#writeTail = write.catch(() => {});
		await write;
		this.changes.emit(snapshot);
		return snapshot;
	}
}
