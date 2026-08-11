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
	model: 'translate-model',
	prompt: '翻译成简体中文',
});
await translation.saveConfig(Object.freeze({
	profiles: Object.freeze([translationProfile]),
	activeBaseUrl: translationProfile.baseUrl,
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
});

const exported = await manager.export();
const exportedText = JSON.stringify(exported);
assert(
	exported.schemaVersion === READER_SETTINGS_CONFIG_EXPORT_VERSION &&
	exported.settingsCount === 2 &&
	exported.customSites[0] === 'forum.example.com' &&
	exported.translation?.profiles[0]?.model === 'translate-model' &&
	exported.webDav?.endpoint === 'https://dav.example.com/' &&
	exported.webDav.categories['offline-topics'] === false &&
	!exportedText.includes('translation-secret-value') &&
	!exportedText.includes('dav-user-secret-value') &&
	!exportedText.includes('dav-password-secret-value'),
	'v7 导出必须组合三类独立设置、保留离线 Topic 开关且不泄露翻译或 WebDAV 凭据',
);

const legacyV6WebDavCategories = Object.fromEntries(Object.entries(
	exported.webDav!.categories,
).filter(([category]) => category !== 'offline-topics'));
const legacyV6Prepared = manager.prepare({
	...exported,
	schemaVersion: 6,
	webDav: {
		...exported.webDav!,
		categories: legacyV6WebDavCategories,
	},
});
assert(
	legacyV6Prepared.sourceVersion === 6 &&
	legacyV6Prepared.webDav?.categories['offline-topics'] === false,
	'旧 v6 组合配置必须兼容导入，并把新增的离线 Topic WebDAV 类别安全保持为默认关闭',
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
	'v7 导入必须应用安全字段、复用同 URL 翻译 Key，并为新 WebDAV 地址清凭据关定时同步',
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
assert(
	secretInjectionRejected,
	'v7 配置必须拒绝伪造的 apiKey 字段，不能静默接纳秘密扩展',
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
	preferences.theme === defaults.theme &&
	preferences.density === defaults.density &&
	customSites.snapshot.length === 0 &&
	String(translation.snapshot.config.profiles[0]?.apiKey) === '' &&
	webDav.snapshot.config.username === '' &&
	webDav.snapshot.config.password === '' &&
	!webDav.snapshot.config.autoSyncEnabled,
	'恢复全部默认必须覆盖四类设置并清除本机翻译/WebDAV 凭据',
);
