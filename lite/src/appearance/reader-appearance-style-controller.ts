import {
	LifecycleScope,
	type Cleanup,
} from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import type { EmbeddedHostResolvedAppearance } from '../shell/embedded-host-appearance.js';
import {
	READER_APPEARANCE_COLOR_NAMES,
	READER_APPEARANCE_DEFAULT,
	normalizeReaderAppearanceProfile,
	resolveReaderAppearanceColor,
	type ReaderAppearanceColorName,
	type ReaderAppearanceProfile,
	type ReaderAppearanceTheme,
	type ReaderPreferences,
} from '../state/reader-preferences-schema.js';

export interface ReaderAppearancePreferencesAdapter<
	TPreferences extends object,
> {
	readProfile(preferences: Readonly<TPreferences>): ReaderAppearanceProfile;
	createPatch(profile: ReaderAppearanceProfile): Partial<TPreferences>;
}

export const readerPreferencesAppearanceAdapter:
ReaderAppearancePreferencesAdapter<ReaderPreferences> = Object.freeze({
	readProfile: (preferences: Readonly<ReaderPreferences>) =>
		preferences.appearanceProfile,
	createPatch: (profile: ReaderAppearanceProfile) => ({
		appearanceProfile: profile,
	}),
});

export interface ReaderAppearanceEnvironmentPort {
	read(): EmbeddedHostResolvedAppearance;
	subscribe(
		listener: (appearance: EmbeddedHostResolvedAppearance) => void,
		scope: LifecycleScope,
	): Cleanup;
}

export interface ReaderAppearanceStyleControllerOptions<
	TPreferences extends object,
> {
	readonly root: HTMLElement;
	readonly preferences: ReaderAppearancePreferencesAdapter<TPreferences>;
	readonly readPreferences: () => Readonly<TPreferences>;
	readonly preferenceChanges: {
		subscribe(
			listener: (preferences: Readonly<TPreferences>) => void,
			scope: LifecycleScope,
		): Cleanup;
	};
	readonly environment: ReaderAppearanceEnvironmentPort;
	readonly parentScope?: LifecycleScope;
}

export interface ReaderAppearanceResolvedColors {
	readonly accentColor: string;
	readonly linkColor: string;
	readonly zebraColor: string;
	readonly listZebraColor: string;
	readonly replyLineColor: string;
	readonly quoteLineColor: string;
	readonly dividerLineColor: string;
}

export interface ReaderAppearanceInteractionColors {
	readonly accentColor: string;
	readonly accentLowColor: string;
	readonly linkColor: string;
}

export interface ReaderAppearanceStyleSnapshot {
	readonly profile: ReaderAppearanceProfile;
	readonly theme: ReaderAppearanceTheme;
	readonly colors: ReaderAppearanceResolvedColors;
	readonly interaction: ReaderAppearanceInteractionColors;
	readonly previewing: boolean;
	readonly embedded: EmbeddedHostResolvedAppearance;
}

interface InlineStyleSnapshot {
	readonly value: string;
	readonly priority: string;
}

const STYLE_PROPERTIES = Object.freeze([
	'--tertiary',
	'--tertiary-low',
	'--d-link-color',
	'--ldp-zebra-color',
	'--ldp-zebra-radius',
	'--ldp-reply-line-color',
	'--ldp-reply-line-width',
	'--ldp-reply-line-hit-width',
	'--ldp-reply-line-emphasis-width',
	'--ldp-reply-line-secondary-width',
	'--ldp-reply-line-radius',
	'--ldp-quote-line-color',
	'--ldp-quote-line-width',
	'--ldp-quote-line-emphasis-width',
	'--ldp-divider-line-color',
	'--ldp-divider-line-width',
	'--ldp-divider-line-emphasis-width',
]);

function sameProfile(
	left: ReaderAppearanceProfile,
	right: ReaderAppearanceProfile,
): boolean {
	return Object.keys(READER_APPEARANCE_DEFAULT).every((key) =>
		Object.is(
			left[key as keyof ReaderAppearanceProfile],
			right[key as keyof ReaderAppearanceProfile],
		),
	);
}

function resolvedColors(
	profile: ReaderAppearanceProfile,
	theme: ReaderAppearanceTheme,
): ReaderAppearanceResolvedColors {
	return Object.freeze(Object.fromEntries(
		READER_APPEARANCE_COLOR_NAMES.map((name) => [
			name,
			resolveReaderAppearanceColor(profile, name, theme),
		]),
	) as unknown as ReaderAppearanceResolvedColors);
}

function resolvedProfile(
	profile: ReaderAppearanceProfile,
	colors: ReaderAppearanceResolvedColors,
): ReaderAppearanceProfile {
	const result: Record<string, unknown> = { ...profile };
	for (const name of READER_APPEARANCE_COLOR_NAMES) {
		result[name] = colors[name];
		result[`${name}Dark`] = colors[name];
	}
	return Object.freeze(result) as unknown as ReaderAppearanceProfile;
}

/**
 * Reader 外观 CSS 与预览的唯一 runtime owner。
 *
 * 设置 form 只提交完整 profile；主题适配、结构线开关、Reader root 变量和 embedded host
 * 投影在这里一次完成，避免 form、Workspace 与宿主适配器各维护一份颜色状态。
 */
export class ReaderAppearanceStyleController<
	TPreferences extends object,
> {
	readonly scope: LifecycleScope;
	readonly changes = new Signal<ReaderAppearanceStyleSnapshot>();
	readonly embeddedChanges = new Signal<EmbeddedHostResolvedAppearance>();
	readonly #root: HTMLElement;
	readonly #adapter: ReaderAppearancePreferencesAdapter<TPreferences>;
	readonly #environment: ReaderAppearanceEnvironmentPort;
	readonly #original = new Map<string, InlineStyleSnapshot>();
	readonly #originalDisabled: boolean;
	#preferences: Readonly<TPreferences>;
	#environmentAppearance: EmbeddedHostResolvedAppearance;
	#preview: ReaderAppearanceProfile | null = null;
	#snapshot: ReaderAppearanceStyleSnapshot;

	constructor(options: ReaderAppearanceStyleControllerOptions<TPreferences>) {
		this.#root = options.root;
		this.#adapter = options.preferences;
		this.#environment = options.environment;
		this.#preferences = options.readPreferences();
		this.#environmentAppearance = this.#environment.read();
		this.#originalDisabled = this.#root.classList.contains(
			'ldp-structure-colors-disabled',
		);
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		for (const property of STYLE_PROPERTIES) {
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
			const previous = this.profile();
			this.#preferences = preferences;
			if (sameProfile(previous, this.profile())) return;
			this.#publish();
		}, this.scope);
		this.#environment.subscribe((appearance) => {
			this.#environmentAppearance = appearance;
			this.#publish();
		}, this.scope);
		this.scope.add(() => {
			this.changes.clear();
			this.embeddedChanges.clear();
			this.#preview = null;
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
			this.#root.classList.toggle(
				'ldp-structure-colors-disabled',
				this.#originalDisabled,
			);
		});
	}

	get snapshot(): ReaderAppearanceStyleSnapshot {
		return this.#snapshot;
	}

	profile(): ReaderAppearanceProfile {
		return normalizeReaderAppearanceProfile(
			this.#adapter.readProfile(this.#preferences),
		);
	}

	readProfile(preferences: Readonly<TPreferences>): ReaderAppearanceProfile {
		return normalizeReaderAppearanceProfile(
			this.#adapter.readProfile(preferences),
		);
	}

	createPatch(profile: ReaderAppearanceProfile): Partial<TPreferences> {
		return this.#adapter.createPatch(
			normalizeReaderAppearanceProfile(profile),
		);
	}

	preview(profile: ReaderAppearanceProfile): void {
		if (this.scope.destroyed) return;
		const normalized = normalizeReaderAppearanceProfile(profile);
		if (this.#preview && sameProfile(this.#preview, normalized)) return;
		this.#preview = normalized;
		this.#publish();
	}

	clearPreview(): void {
		if (this.scope.destroyed || this.#preview === null) return;
		this.#preview = null;
		this.#publish();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#publish(): void {
		this.#snapshot = this.#commit();
		this.changes.emit(this.#snapshot);
		this.embeddedChanges.emit(this.#snapshot.embedded);
	}

	#commit(): ReaderAppearanceStyleSnapshot {
		const profile = this.#preview ?? this.profile();
		const theme = this.#environmentAppearance.theme;
		const colors = resolvedColors(profile, theme);
		const enabled = profile.structureColorsEnabled;
		const lineColor = (name: ReaderAppearanceColorName) =>
			enabled ? colors[name] : 'transparent';
		const accentDefault = resolveReaderAppearanceColor(
			READER_APPEARANCE_DEFAULT,
			'accentColor',
			theme,
		);
		const accentLowColor = colors.accentColor === accentDefault
			? theme === 'dark' ? '#223a2c' : '#dceee2'
			: `color-mix(in srgb,${colors.accentColor} 18%,var(--secondary,#fff))`;
		this.#root.style.setProperty('--tertiary', colors.accentColor);
		this.#root.style.setProperty(
			'--tertiary-low',
			accentLowColor,
		);
		this.#root.style.setProperty('--d-link-color', colors.linkColor);
		this.#root.style.setProperty('--ldp-zebra-color', colors.zebraColor);
		this.#root.style.setProperty(
			'--ldp-zebra-radius',
			`${profile.zebraRadius}px`,
		);
		this.#root.style.setProperty(
			'--ldp-reply-line-color',
			lineColor('replyLineColor'),
		);
		this.#root.style.setProperty(
			'--ldp-reply-line-width',
			`${profile.replyLineWidth}px`,
		);
		this.#root.style.setProperty(
			'--ldp-reply-line-hit-width',
			`${Math.max(8, profile.replyLineWidth + 6)}px`,
		);
		this.#root.style.setProperty(
			'--ldp-reply-line-emphasis-width',
			`${profile.replyLineWidth * 2}px`,
		);
		this.#root.style.setProperty(
			'--ldp-reply-line-secondary-width',
			`${profile.replyLineWidth + 0.5}px`,
		);
		this.#root.style.setProperty(
			'--ldp-reply-line-radius',
			`${profile.replyLineRadius}px`,
		);
		this.#root.style.setProperty(
			'--ldp-quote-line-color',
			lineColor('quoteLineColor'),
		);
		this.#root.style.setProperty(
			'--ldp-quote-line-width',
			`${profile.quoteLineWidth}px`,
		);
		this.#root.style.setProperty(
			'--ldp-quote-line-emphasis-width',
			`${profile.quoteLineWidth * 5}px`,
		);
		this.#root.style.setProperty(
			'--ldp-divider-line-color',
			lineColor('dividerLineColor'),
		);
		this.#root.style.setProperty(
			'--ldp-divider-line-width',
			`${profile.dividerLineWidth}px`,
		);
		this.#root.style.setProperty(
			'--ldp-divider-line-emphasis-width',
			`${profile.dividerLineWidth * 2}px`,
		);
		this.#root.classList.toggle(
			'ldp-structure-colors-disabled',
			!enabled,
		);
		const embedded = Object.freeze({
			profile: resolvedProfile(profile, colors),
			theme,
			defaultDividerLineColor:
				this.#environmentAppearance.defaultDividerLineColor,
			defaultDividerLineWidth:
				this.#environmentAppearance.defaultDividerLineWidth,
		});
		return Object.freeze({
			profile,
			theme,
			colors,
			interaction: Object.freeze({
				accentColor: colors.accentColor,
				accentLowColor,
				linkColor: colors.linkColor,
			}),
			previewing: this.#preview !== null,
			embedded,
		});
	}
}
