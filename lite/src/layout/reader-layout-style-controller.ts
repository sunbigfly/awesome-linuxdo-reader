import {
	LifecycleScope,
	type Cleanup,
} from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import {
	READER_LAYOUT_REGIONS,
	type ReaderLayoutProfile,
	type ReaderPreferences,
} from '../state/reader-preferences-schema.js';

export type ReaderLayoutMode = 'standard' | 'fullpage';

export interface ReaderLayoutPreferencesAdapter<
	TPreferences extends object,
> {
	readProfile(
		preferences: Readonly<TPreferences>,
		mode: ReaderLayoutMode,
	): ReaderLayoutProfile;
	createPatch(
		profile: ReaderLayoutProfile,
		mode: ReaderLayoutMode,
	): Partial<TPreferences>;
}

export const readerPreferencesLayoutAdapter:
ReaderLayoutPreferencesAdapter<ReaderPreferences> = Object.freeze({
	readProfile: (
		preferences: Readonly<ReaderPreferences>,
		mode: ReaderLayoutMode,
	) =>
		mode === 'fullpage'
			? preferences.fullpageLayoutProfile
			: preferences.layoutProfile,
	createPatch: (
		profile: ReaderLayoutProfile,
		mode: ReaderLayoutMode,
	) =>
		mode === 'fullpage'
			? { fullpageLayoutProfile: profile }
			: { layoutProfile: profile },
});

export interface ReaderLayoutModePort {
	read(): ReaderLayoutMode;
	subscribe(
		listener: (mode: ReaderLayoutMode) => void,
		scope: LifecycleScope,
	): Cleanup;
}

export interface ReaderLayoutStyleControllerOptions<
	TPreferences extends object,
> {
	readonly root: HTMLElement;
	readonly preferences: ReaderLayoutPreferencesAdapter<TPreferences>;
	readonly readPreferences: () => Readonly<TPreferences>;
	readonly preferenceChanges: {
		subscribe(
			listener: (preferences: Readonly<TPreferences>) => void,
			scope: LifecycleScope,
		): Cleanup;
	};
	readonly mode: ReaderLayoutModePort;
	readonly parentScope?: LifecycleScope;
}

export interface ReaderLayoutStyleSnapshot {
	readonly mode: ReaderLayoutMode;
	readonly profile: ReaderLayoutProfile;
	readonly previewing: boolean;
}

interface InlineStyleSnapshot {
	readonly value: string;
	readonly priority: string;
}

function sameProfile(
	left: ReaderLayoutProfile,
	right: ReaderLayoutProfile,
): boolean {
	return READER_LAYOUT_REGIONS.every(
		(region) => left[region] === right[region],
	);
}

/**
 * 五区布局 CSS 变量和实时预览的唯一 runtime owner。
 *
 * 设置 form 只能提交 profile preview；偏好/工作区模式变化与最终 CSS 投影都在此汇合。
 */
export class ReaderLayoutStyleController<TPreferences extends object> {
	readonly scope: LifecycleScope;
	readonly changes = new Signal<ReaderLayoutStyleSnapshot>();
	readonly #root: HTMLElement;
	readonly #adapter: ReaderLayoutPreferencesAdapter<TPreferences>;
	readonly #modePort: ReaderLayoutModePort;
	readonly #original = new Map<string, InlineStyleSnapshot>();
	readonly #previews = new Map<ReaderLayoutMode, ReaderLayoutProfile>();
	#preferences: Readonly<TPreferences>;
	#mode: ReaderLayoutMode;
	#snapshot: ReaderLayoutStyleSnapshot;

	constructor(options: ReaderLayoutStyleControllerOptions<TPreferences>) {
		this.#root = options.root;
		this.#adapter = options.preferences;
		this.#modePort = options.mode;
		this.#preferences = options.readPreferences();
		this.#mode = this.#modePort.read();
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		for (const region of READER_LAYOUT_REGIONS) {
			const property = `--ldp-layout-${region}`;
			this.#original.set(property, Object.freeze({
				value: this.#root.style.getPropertyValue(property),
				priority:
					typeof this.#root.style.getPropertyPriority === 'function'
						? this.#root.style.getPropertyPriority(property)
						: '',
			}));
		}
		this.#snapshot = this.#commit();
		options.preferenceChanges.subscribe((preferences) => {
			this.#preferences = preferences;
			this.#publish();
		}, this.scope);
		this.#modePort.subscribe((mode) => {
			if (mode === this.#mode) return;
			this.#mode = mode;
			this.#publish();
		}, this.scope);
		this.scope.add(() => {
			this.changes.clear();
			this.#previews.clear();
			for (const [property, previous] of this.#original) {
				if (previous.value) {
					this.#root.style.setProperty(
						property,
						previous.value,
						previous.priority,
					);
				} else {
					this.#root.style.removeProperty(property);
				}
			}
		});
	}

	get snapshot(): ReaderLayoutStyleSnapshot {
		return this.#snapshot;
	}

	get mode(): ReaderLayoutMode {
		return this.#mode;
	}

	profile(mode: ReaderLayoutMode): ReaderLayoutProfile {
		return this.#adapter.readProfile(this.#preferences, mode);
	}

	readProfile(
		preferences: Readonly<TPreferences>,
		mode: ReaderLayoutMode,
	): ReaderLayoutProfile {
		return this.#adapter.readProfile(preferences, mode);
	}

	createPatch(
		profile: ReaderLayoutProfile,
		mode: ReaderLayoutMode,
	): Partial<TPreferences> {
		return this.#adapter.createPatch(profile, mode);
	}

	preview(profile: ReaderLayoutProfile, mode = this.#mode): void {
		if (this.scope.destroyed) return;
		const previous = this.#previews.get(mode);
		if (previous && sameProfile(previous, profile)) return;
		this.#previews.set(mode, Object.freeze({ ...profile }));
		if (mode === this.#mode) this.#publish();
	}

	clearPreview(mode?: ReaderLayoutMode): void {
		if (this.scope.destroyed) return;
		if (mode) {
			if (!this.#previews.delete(mode)) return;
			if (mode === this.#mode) this.#publish();
			return;
		}
		if (this.#previews.size === 0) return;
		const currentChanged = this.#previews.has(this.#mode);
		this.#previews.clear();
		if (currentChanged) this.#publish();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#publish(): void {
		this.#snapshot = this.#commit();
		this.changes.emit(this.#snapshot);
	}

	#commit(): ReaderLayoutStyleSnapshot {
		const preview = this.#previews.get(this.#mode);
		const profile = preview ?? this.profile(this.#mode);
		for (const region of READER_LAYOUT_REGIONS) {
			this.#root.style.setProperty(
				`--ldp-layout-${region}`,
				`${profile[region]}%`,
			);
		}
		return Object.freeze({
			mode: this.#mode,
			profile,
			previewing: Boolean(preview),
		});
	}
}
