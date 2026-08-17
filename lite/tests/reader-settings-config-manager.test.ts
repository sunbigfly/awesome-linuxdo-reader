import { ReaderCustomSiteRepository } from
	'../src/site/reader-custom-site-repository.js';
import { PreferencesConfigCodec } from
	'../src/state/preferences-config-codec.js';
import {
	READER_SETTINGS_CONFIG_EXPORT_VERSION,
	ReaderSettingsConfigCodec,
	ReaderSettingsConfigManager,
} from '../src/state/reader-settings-config-manager.js';
import { ReaderWebDavConfigRepository } from
	'../src/sync/reader-webdav-config-repository.js';
import {
	createReaderWebDavCategorySelection,
	createReaderWebDavDefaultConfig,
} from '../src/sync/reader-webdav-model.js';
import {
	createReaderTranslationDefaultProfile,
	normalizeReaderAiModelCatalogEntry,
	ReaderTranslationConfigRepository,
} from '../src/translation/reader-translation-config.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestPreferences {
	readonly theme: string;
	readonly density: number;
}

const defaults: Readonly<TestPreferences> = Object.freeze({
	theme: 'system',
	density: 1,
});
const preferencesCodec = new PreferencesConfigCodec<TestPreferences>({
	format: 'awesome-linuxdo-reader-settings',
	schemaVersion: 5,
	scriptVersion: 'test',
	defaults,
	normalize: (input) => Object.freeze({
		theme: String(input.theme ?? defaults.theme),
		density: Math.max(1, Math.min(3, Number(input.density) || 1)),
	}),
	now: () => new Date('2026-08-09T00:00:00.000Z'),
});
const codec = new ReaderSettingsConfigCodec(preferencesCodec);
const storage = new Map<string, unknown>();
const valueStorage = {
	getValue: (key: string) => storage.get(key),
	setValue: (key: string, value: unknown) => {
		storage.set(key, value);
	},
};
const customSites = new ReaderCustomSiteRepository({ storage: valueStorage });
const translation = new ReaderTranslationConfigRepository({
	storage: valueStorage,
});
const webDav = new ReaderWebDavConfigRepository({
	storage: valueStorage,
	createWriterId: () => 'device:test',
});
await customSites.add('forum.example.com');
const translationProfile = Object.freeze({
	...createReaderTranslationDefaultProfile(),
	baseUrl: 'https://translate.example.com/v1/',
	apiKey: 'translation-secret-value',
	models: Object.freeze(['translate-model']),
	modelCatalog: Object.freeze([normalizeReaderAiModelCatalogEntry({
		id: 'translate-model',
		name: 'Translate Pro',
		context_length: 200_000,
		architecture: { output_modalities: ['text'] },
		benchmarks: {
			artificial_analysis: { intelligence_index: 70 },
		},
	})!]),
	model: 'translate-model',
	prompt: '翻译成简体中文',
});
await translation.saveConfig(Object.freeze({
	profiles: Object.freeze([translationProfile]),
	activeBaseUrl: translationProfile.baseUrl,
	animation: translationProfile.animation,
}));
await webDav.saveConfig(Object.freeze({
	...createReaderWebDavDefaultConfig(),
	endpoint: 'https://dav.example.com/',
	username: 'dav-user-secret-value',
	password: 'dav-password-secret-value',
	remotePath: 'Reader/settings.json',
	categories: createReaderWebDavCategorySelection({
		preferences: true,
		translation: true,
	}),
	autoSyncEnabled: true,
}));

let preferences: Readonly<TestPreferences> = Object.freeze({
	theme: 'dark',
	density: 2,
});
const manager = new ReaderSettingsConfigManager({
	codec,
	defaults,
	preferences: {
		read: () => preferences,
		update: (next) => {
			preferences = Object.freeze({ ...next });
		},
	},
	customSites,
	translation,
	webDav,
	prepareResetPreferences: (resetDefaults, current) => Object.freeze({
		...resetDefaults,
		theme: current.theme,
	}),
});

const exported = await manager.export();
const exportedText = JSON.stringify(exported);
assert(
	exported.schemaVersion === READER_SETTINGS_CONFIG_EXPORT_VERSION &&
	exported.settingsCount === 2 &&
	exported.customSites[0] === 'forum.example.com' &&
	exported.translation?.profiles[0]?.models.includes('translate-model') &&
	exported.translation?.profiles[0]?.modelCatalog[0]?.contextLength === 200_000 &&
	exported.translation?.profiles[0]?.modelCatalog[0]?.intelligenceScore === 70 &&
	exported.translation?.profiles[0]?.model === 'translate-model' &&
	exported.webDav?.endpoint === 'https://dav.example.com/' &&
	exported.webDav.categories['offline-topics'] === false &&
	exported.webDav.categories['notification-history'] === false &&
	exported.webDav.categories['activity-history'] === false &&
	!exportedText.includes('translation-secret-value') &&
	!exportedText.includes('dav-user-secret-value') &&
	!exportedText.includes('dav-password-secret-value'),
	'v9 导出必须组合模型元数据目录与三类独立设置、保留新增 WebDAV 开关且不泄露翻译或 WebDAV 凭据',
);

for (const invalidMetadata of [
	{ ...exported, schemaVersion: '9' },
	{ ...exported, settingsCount: '2' },
	{ ...exported, scriptVersion: 9 },
	{ ...exported, exportedAt: 9 },
]) {
	let rejected = false;
	try {
		manager.prepare(invalidMetadata);
	} catch (error) {
		rejected = error instanceof Error && error.message === 'invalid_config';
	}
	assert(rejected, 'v9 组合配置的版本、计数与时间元数据必须保持精确字段类型');
}

const legacyV8Prepared = manager.prepare({
	...exported,
	schemaVersion: 8,
	translation: {
		...exported.translation!,
		profiles: exported.translation!.profiles.map((profile) => {
			const { modelCatalog: _modelCatalog, ...legacyProfile } = profile;
			return legacyProfile;
		}),
	},
});
assert(
	legacyV8Prepared.sourceVersion === 8 &&
	legacyV8Prepared.translation?.profiles[0]?.modelCatalog[0]?.id ===
		'translate-model',
	'较早导出的 v8 配置必须兼容导入，并为旧模型 ID 补齐最小元数据',
);

let incompleteV9Rejected = false;
try {
	manager.prepare({
		...exported,
		translation: {
			...exported.translation!,
			profiles: exported.translation!.profiles.map((profile) => {
				const { modelCatalog: _modelCatalog, ...incompleteProfile } = profile;
				return incompleteProfile;
			}),
		},
	});
} catch (error) {
	incompleteV9Rejected = error instanceof Error &&
		error.message === 'invalid_config';
}
assert(
	incompleteV9Rejected,
	'当前 v9 配置缺少模型目录时必须拒绝，不能套用 v8 迁移规则静默补值',
);

const legacyV6WebDavCategories = Object.fromEntries(Object.entries(
	exported.webDav!.categories,
).filter(([category]) => ![
	'offline-topics',
	'notification-history',
	'activity-history',
].includes(category)));
const preHistoryV7Prepared = manager.prepare({
	...exported,
	schemaVersion: 7,
	translation: {
		...exported.translation!,
		profiles: exported.translation!.profiles.map((profile) => {
			const {
				models: _models,
				modelCatalog: _modelCatalog,
				...legacyProfile
			} = profile;
			return legacyProfile;
		}),
	},
	webDav: {
		...exported.webDav!,
		categories: Object.fromEntries(Object.entries(
			exported.webDav!.categories,
		).filter(([category]) => ![
			'notification-history',
			'activity-history',
		].includes(category))),
	},
});
assert(
	preHistoryV7Prepared.sourceVersion === 7 &&
	preHistoryV7Prepared.webDav?.categories['notification-history'] === false &&
	preHistoryV7Prepared.webDav?.categories['activity-history'] === false,
	'较早导出的 v7 配置必须兼容导入，并把新增历史类别保持为默认关闭',
);
const legacyV6Prepared = manager.prepare({
	...exported,
	schemaVersion: 6,
	translation: {
		...exported.translation!,
		profiles: exported.translation!.profiles.map((profile) => {
			const {
				models: _models,
				modelCatalog: _modelCatalog,
				...legacyProfile
			} = profile;
			return legacyProfile;
		}),
	},
	webDav: {
		...exported.webDav!,
		categories: legacyV6WebDavCategories,
	},
});
assert(
	legacyV6Prepared.sourceVersion === 6 &&
	legacyV6Prepared.webDav?.categories['offline-topics'] === false &&
	legacyV6Prepared.webDav?.categories['notification-history'] === false &&
	legacyV6Prepared.webDav?.categories['activity-history'] === false,
	'旧 v6 组合配置必须兼容导入，并把新增 WebDAV 类别安全保持为默认关闭',
);

let incompleteV9WebDavRejected = false;
try {
	manager.prepare({
		...exported,
		webDav: {
			...exported.webDav!,
			categories: Object.fromEntries(Object.entries(
				exported.webDav!.categories,
			).filter(([category]) => ![
				'notification-history',
				'activity-history',
			].includes(category))),
		},
	});
} catch (error) {
	incompleteV9WebDavRejected = error instanceof Error &&
		error.message === 'invalid_config';
}
assert(
	incompleteV9WebDavRejected,
	'当前 v9 配置缺少历史同步开关时必须拒绝，不能套用 v7/v8 迁移规则静默补值',
);

const importedPayload = {
	...exported,
	settings: { theme: 'light', density: 3 },
	customSites: ['another.example.com'],
	translation: {
		profiles: exported.translation!.profiles.map((profile) => ({
			...profile,
			prompt: '新的安全翻译规则',
		})),
		activeBaseUrl: exported.translation!.activeBaseUrl,
	},
	webDav: {
		...exported.webDav!,
		endpoint: 'https://dav-new.example.com/',
		autoSyncEnabled: true,
	},
};
const prepared = manager.prepare(importedPayload);
const applied = await manager.apply(prepared);
assert(
	preferences.theme === 'light' &&
	preferences.density === 3 &&
	customSites.snapshot[0] === 'another.example.com' &&
	translation.snapshot.config.profiles[0]?.prompt ===
		'新的安全翻译规则' &&
	translation.snapshot.config.profiles[0]?.apiKey ===
		'translation-secret-value' &&
	webDav.snapshot.config.endpoint === 'https://dav-new.example.com/' &&
	webDav.snapshot.config.username === '' &&
	webDav.snapshot.config.password === '' &&
	!webDav.snapshot.config.autoSyncEnabled &&
	applied.preservedTranslationApiKeys === 1 &&
	applied.webDavAutoSyncDisabled,
	'v9 导入必须应用安全字段、复用同 URL 翻译 Key，并为新 WebDAV 地址清凭据关定时同步',
);

let secretInjectionRejected = false;
try {
	manager.prepare({
		...exported,
		translation: {
			...exported.translation!,
			profiles: [{
				...exported.translation!.profiles[0]!,
				apiKey: 'must-not-import',
			}],
		},
	});
} catch (error) {
	secretInjectionRejected = error instanceof Error &&
		error.message === 'invalid_config';
}
let webDavSecretInjectionRejected = false;
try {
	manager.prepare({
		...exported,
		webDav: {
			...exported.webDav!,
			username: 'must-not-import',
			password: 'must-not-import',
		},
	});
} catch (error) {
	webDavSecretInjectionRejected = error instanceof Error &&
		error.message === 'invalid_config';
}
assert(
	secretInjectionRejected && webDavSecretInjectionRejected,
	'v9 配置必须拒绝伪造的 apiKey、WebDAV 用户名和密码字段，不能静默接纳秘密扩展',
);

let invalidWebDavTargetRejected = false;
try {
	manager.prepare({
		...exported,
		webDav: {
			...exported.webDav!,
			endpoint: '',
			remotePath: '',
		},
	});
} catch (error) {
	invalidWebDavTargetRejected = error instanceof Error &&
		error.message === 'invalid_config';
}
assert(
	invalidWebDavTargetRejected,
	'组合配置导入必须复用 WebDAV 业务校验，不能接受空地址或空远端路径',
);

const sitesBeforeRollback = customSites.snapshot;
const translationBeforeRollback = translation.snapshot.config;
const webDavBeforeRollback = webDav.snapshot.config;
const failingManager = new ReaderSettingsConfigManager({
	codec,
	defaults,
	preferences: {
		read: () => preferences,
		update: () => {
			throw new Error('preference-write-failed');
		},
	},
	customSites,
	translation,
	webDav,
});
let rollbackObserved = false;
try {
	await failingManager.apply(manager.prepare(exported));
} catch (error) {
	rollbackObserved = error instanceof Error &&
		error.message === 'preference-write-failed';
}
assert(
	rollbackObserved &&
	JSON.stringify(customSites.snapshot) === JSON.stringify(sitesBeforeRollback) &&
	JSON.stringify(translation.snapshot.config) ===
		JSON.stringify(translationBeforeRollback) &&
	JSON.stringify(webDav.snapshot.config) === JSON.stringify(webDavBeforeRollback),
	'组合导入最后一步失败时必须逆序恢复三个已写仓储',
);

let translationWritesFail = false;
const guardedTranslationStorage = new Map<string, unknown>();
const guardedTranslation = new ReaderTranslationConfigRepository({
	storage: {
		getValue: (key) => guardedTranslationStorage.get(key),
		setValue: (key, value) => {
			if (translationWritesFail) {
				throw new Error('translation-write-failed');
			}
			guardedTranslationStorage.set(key, value);
		},
	},
});
await guardedTranslation.load();
const guardedTranslationBefore = guardedTranslation.snapshot;
translationWritesFail = true;
let translationWriteRejected = false;
try {
	await guardedTranslation.saveConfig(Object.freeze({
		...guardedTranslationBefore.config,
		profiles: Object.freeze(guardedTranslationBefore.config.profiles.map(
			(profile) => Object.freeze({ ...profile, prompt: '不得泄漏到内存' }),
		)),
	}));
} catch (error) {
	translationWriteRejected = error instanceof Error &&
		error.message === 'translation-write-failed';
}
assert(
	translationWriteRejected &&
	guardedTranslation.snapshot === guardedTranslationBefore,
	'翻译配置持久化失败时必须保留原运行态快照，不能留下仅内存生效的半提交',
);

const legacy = preferencesCodec.export({ theme: 'dark', density: 1 });
const legacyPrepared = manager.prepare(legacy);
await manager.apply(legacyPrepared);
assert(
	String(preferences.theme) === 'dark' &&
	Number(preferences.density) === 1 &&
	customSites.snapshot[0] === 'another.example.com' &&
	translation.snapshot.config.profiles[0]?.prompt ===
		'新的安全翻译规则' &&
	webDav.snapshot.config.endpoint === 'https://dav-new.example.com/',
	'旧 v5 配置只能覆盖 canonical 偏好，三个独立仓储必须保持不变',
);

await manager.reset();
assert(
	String(preferences.theme) === 'dark' &&
	preferences.density === defaults.density &&
	customSites.snapshot.length === 0 &&
	String(translation.snapshot.config.profiles[0]?.apiKey) === '' &&
	webDav.snapshot.config.username === '' &&
	webDav.snapshot.config.password === '' &&
	!webDav.snapshot.config.autoSyncEnabled,
	'恢复全部默认必须允许业务 owner 保留高价值偏好，同时重置其他偏好与三类独立设置',
);
