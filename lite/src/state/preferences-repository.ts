import { Signal } from '../kernel/signal.js';

export interface PreferenceStoragePort {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export type PreferencesCommitSource =
	| 'initial'
	| 'local-update'
	| 'replace'
	| 'external-reload'
	| 'fallback';

export interface PreferencesSnapshot<TPreferences extends object> {
	readonly value: Readonly<TPreferences>;
	readonly revision: number;
	readonly source: PreferencesCommitSource;
}

export interface PreferencesDiagnostic {
	readonly code: 'read-failed' | 'invalid-stored-value' | 'write-failed';
	readonly cause: unknown;
}

export interface PreferencesRepositoryOptions<TPreferences extends object> {
	readonly key: string;
	readonly storage: PreferenceStoragePort;
	readonly defaults: Readonly<TPreferences>;
	readonly normalize: (
		input: Readonly<Record<string, unknown>>,
	) => Readonly<TPreferences>;
	readonly prepareStored?: (
		input: Readonly<Record<string, unknown>>,
	) => Readonly<Record<string, unknown>>;
	readonly serialize?: (value: Readonly<TPreferences>) => string;
	readonly parse?: (value: string) => unknown;
}

function plainRecord(value: unknown): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('偏好存储值必须是对象');
	}
	return value as Readonly<Record<string, unknown>>;
}

function nonEmptyKey(value: string): string {
	const key = String(value).trim();
	if (!key) throw new Error('preferences storage key 不能为空');
	return key;
}

function freezePreferenceValue<T>(value: T, seen = new WeakSet<object>()): Readonly<T> {
	if (!value || typeof value !== 'object') return value;
	const object = value as object;
	if (seen.has(object)) return value;
	seen.add(object);
	if (Array.isArray(value)) {
		for (const entry of value) freezePreferenceValue(entry, seen);
		return Object.freeze(value);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return value;
	for (const entry of Object.values(value)) freezePreferenceValue(entry, seen);
	return Object.freeze(value);
}

/**
 * 偏好数据的唯一 owner。字段迁移和业务归一化由注入的 schema codec 负责；
 * repository 不触碰 DOM，也不执行布局、字体或 Shell 副作用。
 */
export class PreferencesRepository<TPreferences extends object> {
	readonly changes = new Signal<PreferencesSnapshot<TPreferences>>();
	readonly diagnostics = new Signal<PreferencesDiagnostic>();
	readonly #key: string;
	readonly #storage: PreferenceStoragePort;
	readonly #defaults: Readonly<TPreferences>;
	readonly #normalize: PreferencesRepositoryOptions<TPreferences>['normalize'];
	readonly #prepareStored: NonNullable<
		PreferencesRepositoryOptions<TPreferences>['prepareStored']
	>;
	readonly #serialize: (value: Readonly<TPreferences>) => string;
	readonly #parse: (value: string) => unknown;
	#snapshot: PreferencesSnapshot<TPreferences>;

	constructor(options: PreferencesRepositoryOptions<TPreferences>) {
		this.#key = nonEmptyKey(options.key);
		this.#storage = options.storage;
		this.#normalize = options.normalize;
		this.#prepareStored = options.prepareStored ?? ((input) => input);
		this.#serialize = options.serialize ?? JSON.stringify;
		this.#parse = options.parse ?? JSON.parse;
		this.#defaults = freezePreferenceValue({
			...this.#normalize({ ...(options.defaults as Record<string, unknown>) }),
		});
		this.#snapshot = Object.freeze({
			value: this.#defaults,
			revision: 0,
			source: 'fallback',
		});
	}

	get snapshot(): PreferencesSnapshot<TPreferences> {
		return this.#snapshot;
	}

	load(): PreferencesSnapshot<TPreferences> {
		return this.#readAndCommit('initial');
	}

	reloadExternal(): PreferencesSnapshot<TPreferences> {
		return this.#readAndCommit('external-reload');
	}

	update(patch: Partial<TPreferences>): PreferencesSnapshot<TPreferences> {
		return this.#persistAndCommit(
			this.#normalize({
				...(this.#snapshot.value as Record<string, unknown>),
				...(patch as Record<string, unknown>),
			}),
			'local-update',
		);
	}

	replace(value: Readonly<Record<string, unknown>>): PreferencesSnapshot<TPreferences> {
		return this.#persistAndCommit(
			this.#normalize({
				...(this.#defaults as Record<string, unknown>),
				...value,
			}),
			'replace',
		);
	}

	#readAndCommit(source: 'initial' | 'external-reload'): PreferencesSnapshot<TPreferences> {
		let value = this.#defaults;
		let commitSource: PreferencesCommitSource = source;
		try {
			const stored = this.#storage.getItem(this.#key);
			if (stored !== null) {
				const parsed = plainRecord(this.#parse(stored));
				const prepared = plainRecord(this.#prepareStored(parsed));
				value = this.#normalize({
					...(this.#defaults as Record<string, unknown>),
					...prepared,
				});
			}
		} catch (cause) {
			commitSource = 'fallback';
			this.diagnostics.emit(Object.freeze({
				code: cause instanceof TypeError
					? 'invalid-stored-value'
					: 'read-failed',
				cause,
			}));
		}
		return this.#commit(value, commitSource);
	}

	#persistAndCommit(
		value: Readonly<TPreferences>,
		source: 'local-update' | 'replace',
	): PreferencesSnapshot<TPreferences> {
		const frozen = freezePreferenceValue({ ...value });
		try {
			this.#storage.setItem(this.#key, this.#serialize(frozen));
		} catch (cause) {
			this.diagnostics.emit(Object.freeze({ code: 'write-failed', cause }));
			throw cause;
		}
		return this.#commit(frozen, source);
	}

	#commit(
		value: Readonly<TPreferences>,
		source: PreferencesCommitSource,
	): PreferencesSnapshot<TPreferences> {
		const snapshot = Object.freeze({
			value: freezePreferenceValue({ ...value }),
			revision: this.#snapshot.revision + 1,
			source,
		});
		this.#snapshot = snapshot;
		this.changes.emit(snapshot);
		return snapshot;
	}
}
