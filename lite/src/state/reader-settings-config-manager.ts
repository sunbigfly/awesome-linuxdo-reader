import {
	readerBuiltinDiscourseHost,
	normalizeReaderCustomSiteHost,
	type ReaderCustomSiteRepository,
} from '../site/reader-custom-site-repository.js';
import {
	createReaderWebDavCategorySelection,
	createReaderWebDavDefaultConfig,
	normalizeReaderWebDavConfig,
	READER_WEBDAV_CATEGORIES,
	validateReaderWebDavConfig,
	type ReaderWebDavCategorySelection,
	type ReaderWebDavConfig,
} from '../sync/reader-webdav-model.js';
import type { ReaderWebDavConfigRepository } from
	'../sync/reader-webdav-config-repository.js';
import {
	createReaderTranslationDefaultConfig,
	normalizeReaderTranslationBaseUrl,
	normalizeReaderTranslationConfig,
	type ReaderTranslationConfig,
	type ReaderTranslationConfigRepository,
	type ReaderTranslationProfile,
} from '../translation/reader-translation-config.js';
import type {
	PreferencesConfigCodec,
	PreferencesConfigPayload,
} from './preferences-config-codec.js';
import {
	READER_CONFIG_EXPORT_FORMAT,
	READER_CONFIG_EXPORT_VERSION,
} from './reader-preferences-schema.js';

export const READER_SETTINGS_CONFIG_EXPORT_VERSION = 7;
const READER_SETTINGS_CONFIG_PREVIOUS_PORTABLE_VERSION = 6;
export const READER_SETTINGS_CONFIG_OMITTED_SECRETS = Object.freeze([
	'translation.apiKey',
	'webDav.username',
	'webDav.password',
] as const);

export interface ReaderPortableTranslationProfile {
	readonly baseUrl: string;
	readonly model: string;
	readonly prompt: string;
	readonly temperature: number;
	readonly reasoningEffort: string;
	readonly requestsPerMinute: number;
	readonly tokensPerMinute: number;
	readonly animation: ReaderTranslationProfile['animation'];
}

export interface ReaderPortableTranslationConfig {
	readonly profiles: readonly ReaderPortableTranslationProfile[];
	readonly activeBaseUrl: string;
}

export interface ReaderPortableWebDavConfig {
	readonly endpoint: string;
	readonly remotePath: string;
	readonly categories: ReaderWebDavCategorySelection;
	readonly autoSyncEnabled: boolean;
	readonly autoSyncIntervalMinutes:
		ReaderWebDavConfig['autoSyncIntervalMinutes'];
}

export interface ReaderSettingsConfigPayload extends PreferencesConfigPayload {
	readonly schemaVersion: typeof READER_SETTINGS_CONFIG_EXPORT_VERSION;
	readonly customSites: readonly string[];
	readonly translation: ReaderPortableTranslationConfig | null;
	readonly webDav: ReaderPortableWebDavConfig | null;
	readonly omittedSecrets: typeof READER_SETTINGS_CONFIG_OMITTED_SECRETS;
}

export interface ReaderPreparedSettingsConfig<TPreferences extends object> {
	readonly sourceVersion: number;
	readonly settingsCount: number;
	readonly preferences: Readonly<TPreferences>;
	readonly includesPortableSections: boolean;
	readonly customSites: readonly string[] | null;
	/** 已解析的配置中 apiKey 恒为空，只能在提交阶段复用本机同 URL 凭据。 */
	readonly translation: ReaderTranslationConfig | null;
	/** 已解析的配置中 username/password 恒为空。 */
	readonly webDav: ReaderWebDavConfig | null;
}

export interface ReaderSettingsConfigExportInput<TPreferences extends object> {
	readonly preferences: Readonly<TPreferences>;
	readonly customSites: readonly string[];
	readonly translation: ReaderTranslationConfig | null;
	readonly webDav: ReaderWebDavConfig | null;
}

export interface ReaderSettingsConfigApplyResult {
	readonly sourceVersion: number;
	readonly settingsCount: number;
	readonly customSitesApplied: boolean;
	readonly translationApplied: boolean;
	readonly webDavApplied: boolean;
	readonly preservedTranslationApiKeys: number;
	readonly preservedWebDavCredentials: boolean;
	readonly webDavAutoSyncDisabled: boolean;
	readonly skippedSections: readonly string[];
}

interface ReaderPreferencesConfigPort<TPreferences extends object> {
	read(): Readonly<TPreferences>;
	update(value: Readonly<TPreferences>): void | Promise<void>;
}

type ReaderCustomSitesConfigPort = Pick<
	ReaderCustomSiteRepository,
	'load' | 'snapshot' | 'replaceExternal' | 'writable'
>;

type ReaderTranslationConfigPort = Pick<
	ReaderTranslationConfigRepository,
	'load' | 'snapshot' | 'saveConfig'
>;

type ReaderWebDavConfigPort = Pick<
	ReaderWebDavConfigRepository,
	'load' | 'snapshot' | 'saveConfig'
>;

export interface ReaderSettingsConfigManagerOptions<
	TPreferences extends object,
> {
	readonly codec: ReaderSettingsConfigCodec<TPreferences>;
	readonly defaults: Readonly<TPreferences>;
	readonly preferences: ReaderPreferencesConfigPort<TPreferences>;
	readonly customSites: ReaderCustomSitesConfigPort;
	readonly translation: ReaderTranslationConfigPort | null;
	readonly webDav: ReaderWebDavConfigPort | null;
}

function invalidConfig(cause?: unknown): Error {
	return cause === undefined
		? new Error('invalid_config')
		: new Error('invalid_config', { cause });
}

function record(value: unknown): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw invalidConfig();
	}
	return value as Readonly<Record<string, unknown>>;
}

function exactKeys(
	value: Readonly<Record<string, unknown>>,
	expected: readonly string[],
): void {
	const actual = Object.keys(value).sort();
	const canonical = [...expected].sort();
	if (
		actual.length !== canonical.length ||
		actual.some((key, index) => key !== canonical[index])
	) throw invalidConfig();
}

function portableTranslationProfile(
	profile: ReaderTranslationProfile,
): ReaderPortableTranslationProfile {
	return Object.freeze({
		baseUrl: profile.baseUrl,
		model: profile.model,
		prompt: profile.prompt,
		temperature: profile.temperature,
		reasoningEffort: profile.reasoningEffort,
		requestsPerMinute: profile.requestsPerMinute,
		tokensPerMinute: profile.tokensPerMinute,
		animation: profile.animation,
	});
}

function portableTranslationConfig(
	value: ReaderTranslationConfig,
): ReaderPortableTranslationConfig {
	const normalized = normalizeReaderTranslationConfig(value);
	return Object.freeze({
		profiles: Object.freeze(normalized.profiles.map(
			portableTranslationProfile,
		)),
		activeBaseUrl: normalized.activeBaseUrl,
	});
}

function parsePortableTranslationConfig(
	value: unknown,
): ReaderTranslationConfig | null {
	if (value === null) return null;
	const source = record(value);
	exactKeys(source, ['profiles', 'activeBaseUrl']);
	if (!Array.isArray(source.profiles) || !source.profiles.length) {
		throw invalidConfig();
	}
	const profiles = source.profiles.map((value) => {
		const profile = record(value);
		exactKeys(profile, [
			'baseUrl',
			'model',
			'prompt',
			'temperature',
			'reasoningEffort',
			'requestsPerMinute',
			'tokensPerMinute',
			'animation',
		]);
		const normalized = normalizeReaderTranslationConfig({
			profiles: [{ ...profile, apiKey: '' }],
			activeBaseUrl: profile.baseUrl,
		});
		const parsed = normalized.profiles[0];
		if (!parsed) throw invalidConfig();
		const portable = portableTranslationProfile(parsed);
		if (Object.entries(portable).some(([key, normalizedValue]) =>
			profile[key] !== normalizedValue)) {
			throw invalidConfig();
		}
		return parsed;
	});
	if (new Set(profiles.map((profile) => profile.baseUrl)).size !== profiles.length) {
		throw invalidConfig();
	}
	const activeBaseUrl = normalizeReaderTranslationBaseUrl(source.activeBaseUrl);
	if (
		activeBaseUrl !== source.activeBaseUrl ||
		!profiles.some((profile) => profile.baseUrl === activeBaseUrl)
	) throw invalidConfig();
	return normalizeReaderTranslationConfig({
		profiles: Object.freeze(profiles),
		activeBaseUrl,
	});
}

function portableWebDavConfig(
	value: ReaderWebDavConfig,
): ReaderPortableWebDavConfig {
	const normalized = normalizeReaderWebDavConfig(value);
	return Object.freeze({
		endpoint: normalized.endpoint,
		remotePath: normalized.remotePath,
		categories: Object.freeze({ ...normalized.categories }),
		autoSyncEnabled: normalized.autoSyncEnabled,
		autoSyncIntervalMinutes: normalized.autoSyncIntervalMinutes,
	});
}

function parsePortableWebDavConfig(
	value: unknown,
	sourceVersion = READER_SETTINGS_CONFIG_EXPORT_VERSION,
): ReaderWebDavConfig | null {
	if (value === null) return null;
	const source = record(value);
	exactKeys(source, [
		'endpoint',
		'remotePath',
		'categories',
		'autoSyncEnabled',
		'autoSyncIntervalMinutes',
	]);
	const categories = record(source.categories);
	const historyCategories = new Set([
		'notification-history',
		'activity-history',
	]);
	const missesBothHistoryCategories = [...historyCategories].every(
		(category) => !Object.hasOwn(categories, category),
	);
	const expectedCategories = sourceVersion ===
		READER_SETTINGS_CONFIG_PREVIOUS_PORTABLE_VERSION
		? READER_WEBDAV_CATEGORIES.filter((category) =>
			category !== 'offline-topics' && !historyCategories.has(category))
		: missesBothHistoryCategories
			? READER_WEBDAV_CATEGORIES.filter((category) =>
				!historyCategories.has(category))
			: READER_WEBDAV_CATEGORIES;
	exactKeys(categories, expectedCategories);
	if (Object.values(categories).some((selected) => typeof selected !== 'boolean')) {
		throw invalidConfig();
	}
	const normalizedCategories = createReaderWebDavCategorySelection(categories);
	const normalized = normalizeReaderWebDavConfig({
		...source,
		categories: normalizedCategories,
		username: '',
		password: '',
	});
	if (validateReaderWebDavConfig(normalized, {
		requireCredentials: false,
	}).length) throw invalidConfig();
	const portable = portableWebDavConfig(normalized);
	if (
		portable.endpoint !== source.endpoint ||
		portable.remotePath !== source.remotePath ||
		portable.autoSyncEnabled !== source.autoSyncEnabled ||
		portable.autoSyncIntervalMinutes !== source.autoSyncIntervalMinutes ||
		READER_WEBDAV_CATEGORIES.some((category) =>
			portable.categories[category] !== normalizedCategories[category])
	) throw invalidConfig();
	return normalized;
}

function parseCustomSites(value: unknown): readonly string[] {
	if (!Array.isArray(value)) throw invalidConfig();
	const sites = value.map((entry) => {
		if (typeof entry !== 'string') throw invalidConfig();
		const normalized = normalizeReaderCustomSiteHost(entry);
		if (
			!normalized ||
			normalized !== entry ||
			readerBuiltinDiscourseHost(normalized)
		) throw invalidConfig();
		return normalized;
	});
	if (new Set(sites).size !== sites.length) throw invalidConfig();
	return Object.freeze([...sites].sort());
}

/**
 * 设置文件的 v7 安全组合 codec。v5 仍委托 canonical preferences codec 导入；
 * v6 作为缺少离线 Topic 与历史类别的兼容格式继续接受；较早导出的 v7
 * 也允许同时缺少两个历史开关，缺失项会规范化为默认关闭。
 */
export class ReaderSettingsConfigCodec<TPreferences extends object> {
	readonly #preferences: Pick<
		PreferencesConfigCodec<TPreferences>,
		'export' | 'import'
	>;

	constructor(preferences: Pick<
		PreferencesConfigCodec<TPreferences>,
		'export' | 'import'
	>) {
		this.#preferences = preferences;
	}

	export(
		input: ReaderSettingsConfigExportInput<TPreferences>,
	): ReaderSettingsConfigPayload {
		const preferences = this.#preferences.export(input.preferences);
		return Object.freeze({
			...preferences,
			schemaVersion: READER_SETTINGS_CONFIG_EXPORT_VERSION,
			customSites: parseCustomSites(input.customSites),
			translation: input.translation
				? portableTranslationConfig(input.translation)
				: null,
			webDav: input.webDav ? portableWebDavConfig(input.webDav) : null,
			omittedSecrets: READER_SETTINGS_CONFIG_OMITTED_SECRETS,
		});
	}

	import(payload: unknown): ReaderPreparedSettingsConfig<TPreferences> {
		try {
			return this.#import(payload);
		} catch (cause) {
			if (cause instanceof Error && cause.message === 'invalid_config') {
				throw cause;
			}
			throw invalidConfig(cause);
		}
	}

	#import(payload: unknown): ReaderPreparedSettingsConfig<TPreferences> {
		const source = record(payload);
		const schemaVersion = Number(source.schemaVersion);
		if (schemaVersion === READER_CONFIG_EXPORT_VERSION) {
			const preferences = this.#preferences.import(payload);
			return Object.freeze({
				sourceVersion: schemaVersion,
				settingsCount: Number(source.settingsCount),
				preferences,
				includesPortableSections: false,
				customSites: null,
				translation: null,
				webDav: null,
			});
		}
		if (
			schemaVersion !== READER_SETTINGS_CONFIG_EXPORT_VERSION &&
			schemaVersion !== READER_SETTINGS_CONFIG_PREVIOUS_PORTABLE_VERSION
		) {
			throw invalidConfig();
		}
		exactKeys(source, [
			'format',
			'schemaVersion',
			'scriptVersion',
			'exportedAt',
			'settingsCount',
			'settings',
			'customSites',
			'translation',
			'webDav',
			'omittedSecrets',
		]);
		if (
			source.format !== READER_CONFIG_EXPORT_FORMAT ||
			!Array.isArray(source.omittedSecrets) ||
			source.omittedSecrets.length !==
				READER_SETTINGS_CONFIG_OMITTED_SECRETS.length ||
			source.omittedSecrets.some((key, index) =>
				key !== READER_SETTINGS_CONFIG_OMITTED_SECRETS[index])
		) throw invalidConfig();
		const preferences = this.#preferences.import({
			format: source.format,
			schemaVersion: READER_CONFIG_EXPORT_VERSION,
			scriptVersion: source.scriptVersion,
			exportedAt: source.exportedAt,
			settingsCount: source.settingsCount,
			settings: source.settings,
		});
		return Object.freeze({
			sourceVersion: schemaVersion,
			settingsCount: Number(source.settingsCount),
			preferences,
			includesPortableSections: true,
			customSites: parseCustomSites(source.customSites),
			translation: parsePortableTranslationConfig(source.translation),
			webDav: parsePortableWebDavConfig(
				source.webDav,
				schemaVersion,
			),
		});
	}
}

/**
 * 跨偏好、站点、翻译和 WebDAV 配置的唯一提交 owner。各仓储依次提交；任一步失败
 * 都按逆序恢复已写入仓储，避免把组合导入留在部分完成状态。
 */
export class ReaderSettingsConfigManager<TPreferences extends object> {
	readonly #codec: ReaderSettingsConfigCodec<TPreferences>;
	readonly #defaults: Readonly<TPreferences>;
	readonly #preferences: ReaderPreferencesConfigPort<TPreferences>;
	readonly #customSites: ReaderCustomSitesConfigPort;
	readonly #translation: ReaderTranslationConfigPort | null;
	readonly #webDav: ReaderWebDavConfigPort | null;

	constructor(options: ReaderSettingsConfigManagerOptions<TPreferences>) {
		this.#codec = options.codec;
		this.#defaults = options.defaults;
		this.#preferences = options.preferences;
		this.#customSites = options.customSites;
		this.#translation = options.translation;
		this.#webDav = options.webDav;
	}

	async export(): Promise<ReaderSettingsConfigPayload> {
		await Promise.all([
			this.#customSites.load(),
			this.#translation?.load(),
			this.#webDav?.load(),
		]);
		return this.#codec.export({
			preferences: this.#preferences.read(),
			customSites: this.#customSites.snapshot,
			translation: this.#translation?.snapshot.config ?? null,
			webDav: this.#webDav?.snapshot.config ?? null,
		});
	}

	prepare(payload: unknown): ReaderPreparedSettingsConfig<TPreferences> {
		return this.#codec.import(payload);
	}

	apply(
		prepared: ReaderPreparedSettingsConfig<TPreferences>,
	): Promise<ReaderSettingsConfigApplyResult> {
		return this.#apply(prepared, true);
	}

	reset(): Promise<ReaderSettingsConfigApplyResult> {
		return this.#apply(Object.freeze({
			sourceVersion: READER_SETTINGS_CONFIG_EXPORT_VERSION,
			settingsCount: Object.keys(this.#defaults).length,
			preferences: this.#defaults,
			includesPortableSections: true,
			customSites: Object.freeze([]),
			translation: createReaderTranslationDefaultConfig(),
			webDav: createReaderWebDavDefaultConfig(),
		}), false);
	}

	async #apply(
		prepared: ReaderPreparedSettingsConfig<TPreferences>,
		preserveLocalSecrets: boolean,
	): Promise<ReaderSettingsConfigApplyResult> {
		const rollbacks: Array<() => void | Promise<void>> = [];
		const skippedSections: string[] = [];
		let customSitesApplied = false;
		let translationApplied = false;
		let webDavApplied = false;
		let preservedTranslationApiKeys = 0;
		let preservedWebDavCredentials = false;
		let webDavAutoSyncDisabled = false;
		try {
			if (prepared.includesPortableSections && prepared.customSites) {
				if (this.#customSites.writable) {
					const previous = await this.#customSites.load();
					await this.#customSites.replaceExternal(prepared.customSites);
					rollbacks.unshift(async () => {
						await this.#customSites.replaceExternal(previous);
					});
					customSitesApplied = true;
				} else {
					skippedSections.push('customSites');
				}
			}
			if (prepared.includesPortableSections && prepared.translation) {
				if (this.#translation) {
					const previous = (await this.#translation.load()).config;
					const apiKeys = new Map(previous.profiles.map((profile) => [
						profile.baseUrl,
						profile.apiKey,
					]));
					const next = Object.freeze({
						...prepared.translation,
						profiles: Object.freeze(prepared.translation.profiles.map(
							(profile) => {
								const apiKey = preserveLocalSecrets
									? apiKeys.get(profile.baseUrl) ?? ''
									: '';
								if (apiKey) preservedTranslationApiKeys += 1;
								return Object.freeze({ ...profile, apiKey });
							},
						)),
					});
					await this.#translation.saveConfig(next);
					rollbacks.unshift(async () => {
						await this.#translation!.saveConfig(previous);
					});
					translationApplied = true;
				} else {
					skippedSections.push('translation');
				}
			}
			if (prepared.includesPortableSections && prepared.webDav) {
				if (this.#webDav) {
					const previous = (await this.#webDav.load()).config;
					const sameEndpoint =
						previous.endpoint === prepared.webDav.endpoint;
					const username = preserveLocalSecrets && sameEndpoint
						? previous.username
						: '';
					const password = preserveLocalSecrets && sameEndpoint
						? previous.password
						: '';
					preservedWebDavCredentials = Boolean(username && password);
					webDavAutoSyncDisabled = prepared.webDav.autoSyncEnabled &&
						!preservedWebDavCredentials;
					const next = Object.freeze({
						...prepared.webDav,
						username,
						password,
						autoSyncEnabled: prepared.webDav.autoSyncEnabled &&
							preservedWebDavCredentials,
					});
					await this.#webDav.saveConfig(next);
					rollbacks.unshift(async () => {
						await this.#webDav!.saveConfig(previous);
					});
					webDavApplied = true;
				} else {
					skippedSections.push('webDav');
				}
			}
			const previousPreferences = this.#preferences.read();
			await this.#preferences.update(prepared.preferences);
			rollbacks.unshift(async () => {
				await this.#preferences.update(previousPreferences);
			});
			return Object.freeze({
				sourceVersion: prepared.sourceVersion,
				settingsCount: prepared.settingsCount,
				customSitesApplied,
				translationApplied,
				webDavApplied,
				preservedTranslationApiKeys,
				preservedWebDavCredentials,
				webDavAutoSyncDisabled,
				skippedSections: Object.freeze(skippedSections),
			});
		} catch (cause) {
			const rollbackFailures: unknown[] = [];
			for (const rollback of rollbacks) {
				try {
					await rollback();
				} catch (rollbackCause) {
					rollbackFailures.push(rollbackCause);
				}
			}
			if (rollbackFailures.length) {
				throw new Error('设置配置写入失败且回滚不完整', {
					cause: new AggregateError([cause, ...rollbackFailures]),
				});
			}
			throw cause;
		}
	}
}
