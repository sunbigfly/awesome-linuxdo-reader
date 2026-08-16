export interface PreferencesConfigPayload {
	readonly format: string;
	readonly schemaVersion: number;
	readonly scriptVersion: string;
	readonly exportedAt: string;
	readonly settingsCount: number;
	readonly settings: Readonly<Record<string, unknown>>;
}

export interface PreferencesLegacyImportRule {
	readonly missingDefaults: Readonly<Record<string, unknown>>;
}

export interface PreferencesConfigCodecOptions<TPreferences extends object> {
	readonly format: string;
	readonly schemaVersion: number;
	readonly scriptVersion: string;
	readonly defaults: Readonly<TPreferences>;
	readonly normalize: (
		input: Readonly<Record<string, unknown>>,
	) => Readonly<TPreferences>;
	readonly legacyImportRules?: readonly PreferencesLegacyImportRule[];
	readonly now?: () => Date;
}

function nonEmpty(value: unknown, name: string): string {
	const normalized = String(value ?? '').trim();
	if (!normalized) throw new Error(`${name} 不能为空`);
	return normalized;
}

function plainRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${name} 必须是对象`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function exactKeys(
	value: Readonly<Record<string, unknown>>,
	expected: readonly string[],
): boolean {
	const actual = Object.keys(value).sort();
	const canonical = [...expected].sort();
	return actual.length === canonical.length &&
		actual.every((key, index) => key === canonical[index]);
}

/**
 * 偏好导入/导出格式的唯一 codec。字段业务归一化仍由 PreferencesRepository 共用的
 * normalize 注入，不在 codec 内复制布局、字体或性能规则。
 */
export class PreferencesConfigCodec<TPreferences extends object> {
	readonly #format: string;
	readonly #schemaVersion: number;
	readonly #scriptVersion: string;
	readonly #defaults: Readonly<TPreferences>;
	readonly #normalize: PreferencesConfigCodecOptions<TPreferences>['normalize'];
	readonly #legacyRules: readonly PreferencesLegacyImportRule[];
	readonly #settingKeys: readonly string[];
	readonly #settingKeySet: ReadonlySet<string>;
	readonly #now: () => Date;

	constructor(options: PreferencesConfigCodecOptions<TPreferences>) {
		this.#format = nonEmpty(options.format, 'config format');
		if (!Number.isSafeInteger(options.schemaVersion) || options.schemaVersion < 1) {
			throw new RangeError('config schemaVersion 必须是正安全整数');
		}
		this.#schemaVersion = options.schemaVersion;
		this.#scriptVersion = nonEmpty(options.scriptVersion, 'scriptVersion');
		this.#defaults = options.defaults;
		this.#normalize = options.normalize;
		this.#settingKeys = Object.freeze(Object.keys(options.defaults));
		if (!this.#settingKeys.length) throw new Error('preferences defaults 不能为空');
		this.#settingKeySet = new Set(this.#settingKeys);
		this.#legacyRules = Object.freeze((options.legacyImportRules ?? []).map((rule) => {
			const missingDefaults = plainRecord(rule.missingDefaults, 'legacy missingDefaults');
			const keys = Object.keys(missingDefaults);
			if (!keys.length || keys.some((key) => !this.#settingKeySet.has(key))) {
				throw new Error('legacy missingDefaults 必须只包含已知偏好字段');
			}
			return Object.freeze({ missingDefaults: Object.freeze({ ...missingDefaults }) });
		}));
		this.#now = options.now ?? (() => new Date());
	}

	get settingKeys(): readonly string[] {
		return this.#settingKeys;
	}

	export(value: Readonly<Record<string, unknown>>): PreferencesConfigPayload {
		const normalized = this.#normalize({
			...(this.#defaults as Record<string, unknown>),
			...value,
		});
		const settings = Object.freeze(Object.fromEntries(
			this.#settingKeys.map((key) => [key, (normalized as Record<string, unknown>)[key]]),
		));
		return Object.freeze({
			format: this.#format,
			schemaVersion: this.#schemaVersion,
			scriptVersion: this.#scriptVersion,
			exportedAt: this.#now().toISOString(),
			settingsCount: this.#settingKeys.length,
			settings,
		});
	}

	import(payload: unknown): Readonly<TPreferences> {
		try {
			return this.#import(payload);
		} catch (cause) {
			if (cause instanceof Error && cause.message === 'invalid_config') throw cause;
			throw new Error('invalid_config', { cause });
		}
	}

	#import(payload: unknown): Readonly<TPreferences> {
		const record = plainRecord(payload, 'config payload');
		if (
			!exactKeys(record, [
				'format',
				'schemaVersion',
				'scriptVersion',
				'exportedAt',
				'settingsCount',
				'settings',
			]) ||
			record.format !== this.#format ||
			record.schemaVersion !== this.#schemaVersion ||
			typeof record.scriptVersion !== 'string' ||
			!record.scriptVersion.trim() ||
			typeof record.exportedAt !== 'string' ||
			!record.exportedAt.trim()
		) {
			throw new Error('invalid_config');
		}
		const settingsRecord = plainRecord(record.settings, 'config settings');
		const originalKeys = Object.keys(settingsRecord);
		if (
			record.settingsCount !== originalKeys.length ||
			originalKeys.some((key) => !this.#settingKeySet.has(key))
		) {
			throw new Error('invalid_config');
		}
		const migrated: Record<string, unknown> = { ...settingsRecord };
		for (const rule of this.#legacyRules) {
			const allowedMissing = new Set(Object.keys(rule.missingDefaults));
			const matches = this.#settingKeys.every((key) =>
				Object.hasOwn(migrated, key) || allowedMissing.has(key));
			if (!matches) continue;
			for (const [key, value] of Object.entries(rule.missingDefaults)) {
				if (!Object.hasOwn(migrated, key)) migrated[key] = value;
			}
		}
		if (this.#settingKeys.some((key) => !Object.hasOwn(migrated, key))) {
			throw new Error('invalid_config');
		}
		const selected = Object.fromEntries(
			this.#settingKeys.map((key) => [key, migrated[key]]),
		);
		return this.#normalize({
			...(this.#defaults as Record<string, unknown>),
			...selected,
		});
	}
}
