import {
	LifecycleScope,
	type Cleanup,
} from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import {
	READER_FONT_DEFAULT,
	READER_FONT_FAMILIES,
	READER_FONT_SCALE_LIMITS,
	READER_FONT_WEIGHTS,
	READER_HOST_FONT_SCALE_DEFAULTS,
	READER_HOST_FONT_SCALE_LIMITS,
	normalizeReaderFontProfile,
	type ReaderFontFamily,
	type ReaderFontProfile,
	type ReaderFontWeight,
	type ReaderPreferences,
} from '../state/reader-preferences-schema.js';

export interface ReaderFontSettings {
	readonly fontRenderingEnabled: boolean;
	readonly fontRenderingOnHost: boolean;
	readonly hostFontFamily: ReaderFontFamily;
	readonly hostFontCustomFamily: string;
	readonly hostFontWeight: ReaderFontWeight;
	readonly hostFontColor: string;
	readonly hostEmbeddedTitleScale: number;
	readonly hostEmbeddedAvatarScale: number;
	readonly hostEmbeddedStatsScale: number;
	readonly hostEmbeddedLabelCardScale: number;
	readonly fontProfile: ReaderFontProfile;
}

export const READER_FONT_SETTINGS_DEFAULT = Object.freeze<ReaderFontSettings>({
	fontRenderingEnabled: true,
	fontRenderingOnHost: true,
	hostFontFamily: 'system',
	hostFontCustomFamily: '',
	hostFontWeight: 400,
	hostFontColor: '',
	hostEmbeddedTitleScale: READER_HOST_FONT_SCALE_DEFAULTS.title,
	hostEmbeddedAvatarScale: READER_HOST_FONT_SCALE_DEFAULTS.avatar,
	hostEmbeddedStatsScale: READER_HOST_FONT_SCALE_DEFAULTS.stats,
	hostEmbeddedLabelCardScale: READER_HOST_FONT_SCALE_DEFAULTS.labelCard,
	fontProfile: READER_FONT_DEFAULT,
});

export interface ReaderFontPreferencesAdapter<TPreferences extends object> {
	readSettings(preferences: Readonly<TPreferences>): ReaderFontSettings;
	createPatch(settings: ReaderFontSettings): Partial<TPreferences>;
}

export const readerPreferencesFontAdapter:
ReaderFontPreferencesAdapter<ReaderPreferences> = Object.freeze({
	readSettings: (preferences: Readonly<ReaderPreferences>) => ({
		fontRenderingEnabled: preferences.fontRenderingEnabled,
		fontRenderingOnHost: preferences.fontRenderingOnHost,
		hostFontFamily: preferences.hostFontFamily,
		hostFontCustomFamily: preferences.hostFontCustomFamily,
		hostFontWeight: preferences.hostFontWeight,
		hostFontColor: preferences.hostFontColor,
		hostEmbeddedTitleScale: preferences.hostEmbeddedTitleScale,
		hostEmbeddedAvatarScale: preferences.hostEmbeddedAvatarScale,
		hostEmbeddedStatsScale: preferences.hostEmbeddedStatsScale,
		hostEmbeddedLabelCardScale: preferences.hostEmbeddedLabelCardScale,
		fontProfile: preferences.fontProfile,
	}),
	createPatch: (settings: ReaderFontSettings) => ({ ...settings }),
});

export type ReaderFontRenderingMode = 'external' | 'builtin' | 'off';

export interface ReaderFontStyleSnapshot {
	readonly settings: ReaderFontSettings;
	readonly mode: ReaderFontRenderingMode;
	readonly displayScale: number;
	readonly previewing: boolean;
}

export interface ReaderFontStyleControllerOptions<TPreferences extends object> {
	readonly root: HTMLElement;
	readonly pageRoot: HTMLElement;
	readonly resizeTarget?: Element;
	readonly preferences: ReaderFontPreferencesAdapter<TPreferences>;
	readonly readPreferences: () => Readonly<TPreferences>;
	readonly preferenceChanges: {
		subscribe(
			listener: (preferences: Readonly<TPreferences>) => void,
			scope: LifecycleScope,
		): Cleanup;
	};
	readonly readReaderWidth?: () => number;
	readonly readSiteFontFamily?: () => string;
	readonly readExternalFontRendering?: () => boolean;
	readonly userAgent?: string;
	readonly platform?: string;
	readonly createMutationObserver?: (
		callback: MutationCallback,
	) => Pick<MutationObserver, 'observe' | 'disconnect'>;
	readonly createResizeObserver?: (
		callback: ResizeObserverCallback,
	) => Pick<ResizeObserver, 'observe' | 'disconnect'>;
	readonly parentScope?: LifecycleScope;
}

interface InlineStyleSnapshot {
	readonly value: string;
	readonly priority: string;
}

const FONT_STACKS = Object.freeze<Record<ReaderFontFamily, string>>({
	site: 'inherit',
	system: 'system-ui,sans-serif',
	cjkSans:
		'"Noto Sans CJK SC","Microsoft YaHei","PingFang SC",system-ui,sans-serif',
	serif: '"Noto Serif CJK SC","Songti SC",SimSun,serif',
	monospace: 'ui-monospace,SFMono-Regular,Consolas,monospace',
	custom: '',
});
const PROFILE_SCOPES = Object.freeze([
	Object.freeze({
		name: 'interface',
		family: 'family',
		customFamily: 'customFamily',
		weight: 'weight',
		color: 'interfaceColor',
	}),
	Object.freeze({
		name: 'post',
		family: 'postFamily',
		customFamily: 'postCustomFamily',
		weight: 'postWeight',
		color: 'postColor',
	}),
	Object.freeze({
		name: 'composer',
		family: 'composerFamily',
		customFamily: 'composerCustomFamily',
		weight: 'composerWeight',
		color: 'composerColor',
	}),
] as const);
const INTERFACE_FONT_TOKEN_BASES = Object.freeze({
	'--ldp-font-micro': 9,
	'--ldp-font-xs': 10,
	'--ldp-font-sm': 11,
	'--ldp-font-ui': 12,
	'--ldp-font-base': 13,
	'--ldp-font-md': 14,
	'--ldp-font-lg': 15,
	'--ldp-font-xl': 16,
	'--ldp-font-2xl': 17,
	'--ldp-font-3xl': 18,
});
const HOST_SIZE_PROPERTIES = Object.freeze([
	Object.freeze({
		key: 'hostEmbeddedTitleScale',
		values: Object.freeze([['--ldp-host-topic-title-size', 15]] as const),
	}),
	Object.freeze({
		key: 'hostEmbeddedAvatarScale',
		values: Object.freeze([
			['--ldp-host-topic-avatar-size', 32],
			['--ldp-host-topic-avatar-size-medium', 24],
			['--ldp-host-topic-avatar-size-small', 20],
		] as const),
	}),
	Object.freeze({
		key: 'hostEmbeddedStatsScale',
		values: Object.freeze([
			['--ldp-host-topic-stats-size', 10],
			['--ldp-host-topic-stats-label-size', 9],
			['--ldp-host-topic-stats-row-offset', -4],
		] as const),
	}),
	Object.freeze({
		key: 'hostEmbeddedLabelCardScale',
		values: Object.freeze([
			['--ldp-host-label-card-height', 22],
			['--ldp-host-label-card-font-size', 11],
			['--ldp-host-label-card-icon-size', 14],
			['--ldp-host-label-card-gap', 3],
			['--ldp-host-label-card-padding', 7],
		] as const),
	}),
] as const);
const ROOT_PROPERTIES = Object.freeze([
	'--ldp-reader-display-scale',
	'--ldp-reader-title-font-size',
	'--ldp-reader-meta-font-size',
	'--ldp-reader-topic-tag-font-size',
	'--ldp-post-font-size',
	'--ldp-reader-font-weight-base',
	...Object.keys(INTERFACE_FONT_TOKEN_BASES),
	...PROFILE_SCOPES.flatMap((scope) => [
		`--ldp-${scope.name}-font-family`,
		`--ldp-${scope.name}-font-weight`,
		`--ldp-${scope.name}-font-color`,
	]),
]);
const PAGE_PROPERTIES = Object.freeze([
	'--ldp-font-rendering-stroke-runtime',
	'--ldp-font-rendering-shadow-runtime',
	'--ldp-composer-font-size',
	'--ldp-host-font-family',
	'--ldp-host-font-weight',
	'--ldp-host-font-color',
	'--ldp-reader-font-weight-base',
	...PROFILE_SCOPES.flatMap((scope) => [
		`--ldp-${scope.name}-font-family`,
		`--ldp-${scope.name}-font-weight`,
		`--ldp-${scope.name}-font-color`,
	]),
	...HOST_SIZE_PROPERTIES.flatMap((setting) =>
		setting.values.map(([property]) => property),
	),
]);
const EXTERNAL_RENDERING_REFRESH_DELAYS = Object.freeze([50, 250, 1_000]);

function clampedInteger(
	value: unknown,
	fallback: number,
	minimum: number,
	maximum: number,
): number {
	const numeric = Number(value);
	return Number.isFinite(numeric)
		? Math.min(maximum, Math.max(minimum, Math.round(numeric)))
		: fallback;
}

function normalizedFamily(
	value: unknown,
	fallback: ReaderFontFamily,
): ReaderFontFamily {
	return READER_FONT_FAMILIES.includes(value as ReaderFontFamily)
		? value as ReaderFontFamily
		: fallback;
}

function normalizedWeight(
	value: unknown,
	fallback: ReaderFontWeight,
): ReaderFontWeight {
	return READER_FONT_WEIGHTS.includes(value as ReaderFontWeight)
		? value as ReaderFontWeight
		: fallback;
}

function normalizedCustomFamily(value: unknown): string {
	return [...String(value ?? '')
		.replace(/[\u0000-\u001f\u007f"'`,;{}<>\\]/g, '')
		.replace(/\s+/g, ' ')
		.trim()].slice(0, 64).join('');
}

function normalizedColor(value: unknown): string {
	const color = String(value ?? '').trim().toLowerCase();
	return /^#[0-9a-f]{6}$/.test(color) ? color : '';
}

export function normalizeReaderFontSettings(
	value: ReaderFontSettings,
): ReaderFontSettings {
	const hostFontFamily = normalizedFamily(value.hostFontFamily, 'system');
	return Object.freeze({
		fontRenderingEnabled: value.fontRenderingEnabled !== false,
		fontRenderingOnHost: value.fontRenderingOnHost === true,
		hostFontFamily,
		hostFontCustomFamily: normalizedCustomFamily(
			value.hostFontCustomFamily,
		),
		hostFontWeight: normalizedWeight(value.hostFontWeight, 400),
		hostFontColor: normalizedColor(value.hostFontColor),
		hostEmbeddedTitleScale: clampedInteger(
			value.hostEmbeddedTitleScale,
			READER_HOST_FONT_SCALE_DEFAULTS.title,
			READER_HOST_FONT_SCALE_LIMITS.min,
			READER_HOST_FONT_SCALE_LIMITS.max,
		),
		hostEmbeddedAvatarScale: clampedInteger(
			value.hostEmbeddedAvatarScale,
			READER_HOST_FONT_SCALE_DEFAULTS.avatar,
			READER_HOST_FONT_SCALE_LIMITS.min,
			READER_HOST_FONT_SCALE_LIMITS.max,
		),
		hostEmbeddedStatsScale: clampedInteger(
			value.hostEmbeddedStatsScale,
			READER_HOST_FONT_SCALE_DEFAULTS.stats,
			READER_HOST_FONT_SCALE_LIMITS.min,
			READER_HOST_FONT_SCALE_LIMITS.max,
		),
		hostEmbeddedLabelCardScale: clampedInteger(
			value.hostEmbeddedLabelCardScale,
			READER_HOST_FONT_SCALE_DEFAULTS.labelCard,
			READER_HOST_FONT_SCALE_LIMITS.min,
			READER_HOST_FONT_SCALE_LIMITS.max,
		),
		fontProfile: normalizeReaderFontProfile(value.fontProfile),
	});
}

function sameSettings(
	left: ReaderFontSettings,
	right: ReaderFontSettings,
): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function captureStyles(
	element: HTMLElement,
	properties: readonly string[],
): Map<string, InlineStyleSnapshot> {
	return new Map(properties.map((property) => [
		property,
		Object.freeze({
			value: element.style.getPropertyValue(property),
			priority:
				typeof element.style.getPropertyPriority === 'function'
					? element.style.getPropertyPriority(property)
					: '',
		}),
	]));
}

function restoreStyles(
	element: HTMLElement,
	snapshot: ReadonlyMap<string, InlineStyleSnapshot>,
): void {
	for (const [property, previous] of snapshot) {
		if (previous.value) {
			element.style.setProperty(
				property,
				previous.value,
				previous.priority,
			);
		} else {
			element.style.removeProperty(property);
		}
	}
}

/**
 * 字体 profile、宿主字体/尺寸和内置渲染属性的唯一运行时 owner。
 */
export class ReaderFontStyleController<TPreferences extends object> {
	readonly scope: LifecycleScope;
	readonly changes = new Signal<ReaderFontStyleSnapshot>();
	readonly #root: HTMLElement;
	readonly #pageRoot: HTMLElement;
	readonly #adapter: ReaderFontPreferencesAdapter<TPreferences>;
	readonly #readReaderWidth: () => number;
	readonly #readSiteFontFamily: () => string;
	readonly #readExternalFontRendering: () => boolean;
	readonly #rootOriginal: Map<string, InlineStyleSnapshot>;
	readonly #pageOriginal: Map<string, InlineStyleSnapshot>;
	readonly #rootRenderingMode: string | undefined;
	readonly #pageRenderingMode: string | undefined;
	readonly #pageRenderingHost: string | undefined;
	readonly #pageMacSmoothing: boolean;
	readonly #renderingDefaults: Readonly<{
		readonly stroke: number;
		readonly shadow: number;
		readonly macSmoothing: boolean;
	}>;
	#preferences: Readonly<TPreferences>;
	#preview: ReaderFontSettings | null = null;
	#snapshot: ReaderFontStyleSnapshot;
	#externalRefreshEpoch = 0;

	constructor(options: ReaderFontStyleControllerOptions<TPreferences>) {
		this.#root = options.root;
		this.#pageRoot = options.pageRoot;
		this.#adapter = options.preferences;
		this.#preferences = options.readPreferences();
		this.#readReaderWidth = options.readReaderWidth ??
			(() => this.#root.clientWidth || 1_080);
		this.#readSiteFontFamily = options.readSiteFontFamily ??
			(() => 'inherit');
		this.#readExternalFontRendering =
			options.readExternalFontRendering ??
			(() => this.#pageRoot.hasAttribute('fr-init-once'));
		this.#rootOriginal = captureStyles(this.#root, ROOT_PROPERTIES);
		this.#pageOriginal = captureStyles(this.#pageRoot, PAGE_PROPERTIES);
		this.#rootRenderingMode = this.#root.dataset.ldpFontRendering;
		this.#pageRenderingMode =
			this.#pageRoot.dataset.ldpFontRendering;
		this.#pageRenderingHost =
			this.#pageRoot.dataset.ldpFontRenderingHost;
		this.#pageMacSmoothing = this.#pageRoot.hasAttribute(
			'data-ldp-font-mac-smoothing',
		);
		const userAgent = options.userAgent ?? '';
		const isGecko = /Firefox\//.test(userAgent);
		const isWebKit =
			/AppleWebKit\//.test(userAgent) &&
			!/(?:Chrome|Chromium|Edg|OPR|CriOS|FxiOS)\//.test(userAgent);
		this.#renderingDefaults = Object.freeze({
			stroke: isGecko ? 0.03 : isWebKit ? 0.05 : 0.015,
			shadow: isGecko ? 0.55 : isWebKit ? 0.45 : 0.75,
			macSmoothing: /Mac/.test(options.platform ?? ''),
		});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#snapshot = this.#commit();
		options.preferenceChanges.subscribe((preferences) => {
			const previous = this.settings();
			this.#preferences = preferences;
			if (sameSettings(previous, this.settings())) return;
			this.#publish();
		}, this.scope);
		if (options.createMutationObserver) {
			const observer = options.createMutationObserver((records) => {
				if (records.some((record) =>
					record.attributeName === 'fr-init-once'
				)) this.#refreshExternalRendering();
			});
			observer.observe(this.#pageRoot, {
				attributes: true,
				attributeFilter: ['fr-init-once'],
			});
			this.scope.add(() => observer.disconnect());
		}
		if (options.createResizeObserver) {
			const observer = options.createResizeObserver(() => this.#publish());
			observer.observe(options.resizeTarget ?? this.#root);
			this.scope.add(() => observer.disconnect());
		}
		this.scope.add(() => {
			this.changes.clear();
			this.#preview = null;
			restoreStyles(this.#root, this.#rootOriginal);
			restoreStyles(this.#pageRoot, this.#pageOriginal);
			if (this.#rootRenderingMode === undefined) {
				delete this.#root.dataset.ldpFontRendering;
			} else {
				this.#root.dataset.ldpFontRendering =
					this.#rootRenderingMode;
			}
			if (this.#pageRenderingMode === undefined) {
				delete this.#pageRoot.dataset.ldpFontRendering;
			} else {
				this.#pageRoot.dataset.ldpFontRendering =
					this.#pageRenderingMode;
			}
			if (this.#pageRenderingHost === undefined) {
				delete this.#pageRoot.dataset.ldpFontRenderingHost;
			} else {
				this.#pageRoot.dataset.ldpFontRenderingHost =
					this.#pageRenderingHost;
			}
			this.#pageRoot.toggleAttribute(
				'data-ldp-font-mac-smoothing',
				this.#pageMacSmoothing,
			);
		});
	}

	get snapshot(): ReaderFontStyleSnapshot {
		return this.#snapshot;
	}

	settings(): ReaderFontSettings {
		return normalizeReaderFontSettings(
			this.#adapter.readSettings(this.#preferences),
		);
	}

	readSettings(preferences: Readonly<TPreferences>): ReaderFontSettings {
		return normalizeReaderFontSettings(
			this.#adapter.readSettings(preferences),
		);
	}

	createPatch(settings: ReaderFontSettings): Partial<TPreferences> {
		return this.#adapter.createPatch(
			normalizeReaderFontSettings(settings),
		);
	}

	preview(settings: ReaderFontSettings): void {
		if (this.scope.destroyed) return;
		const normalized = normalizeReaderFontSettings(settings);
		if (this.#preview && sameSettings(this.#preview, normalized)) return;
		this.#preview = normalized;
		this.#publish();
	}

	clearPreview(): void {
		if (this.scope.destroyed || this.#preview === null) return;
		this.#preview = null;
		this.#publish();
	}

	refresh(): void {
		if (!this.scope.destroyed) this.#publish();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#publish(): void {
		this.#snapshot = this.#commit();
		this.changes.emit(this.#snapshot);
	}

	#refreshExternalRendering(): void {
		const epoch = ++this.#externalRefreshEpoch;
		const refresh = (): void => {
			if (
				this.scope.destroyed ||
				epoch !== this.#externalRefreshEpoch
			) return;
			this.#publish();
			if (this.#snapshot.mode === 'external') {
				this.#externalRefreshEpoch += 1;
			}
		};
		refresh();
		if (
			this.#snapshot.mode === 'external' ||
			!this.#pageRoot.hasAttribute('fr-init-once')
		) return;
		for (const delay of EXTERNAL_RENDERING_REFRESH_DELAYS) {
			this.scope.timer(
				setTimeout(refresh, delay) as unknown as number,
			);
		}
	}

	#fontFamily(
		family: ReaderFontFamily,
		customFamily: string,
	): string {
		if (family === 'site') return this.#readSiteFontFamily() || 'inherit';
		if (family !== 'custom') return FONT_STACKS[family];
		const normalized = normalizedCustomFamily(customFamily);
		return normalized
			? `${JSON.stringify(normalized)},${FONT_STACKS.system}`
			: FONT_STACKS.system;
	}

	#applyProfile(
		element: HTMLElement,
		profile: ReaderFontProfile,
	): void {
		for (const scope of PROFILE_SCOPES) {
			const prefix = `--ldp-${scope.name}-font`;
			element.style.setProperty(
				`${prefix}-family`,
				this.#fontFamily(
					profile[scope.family],
					profile[scope.customFamily],
				),
			);
			element.style.setProperty(
				`${prefix}-weight`,
				String(profile[scope.weight]),
			);
			const color = profile[scope.color];
			if (color) element.style.setProperty(`${prefix}-color`, color);
			else element.style.removeProperty(`${prefix}-color`);
		}
		element.style.setProperty(
			'--ldp-reader-font-weight-base',
			String(profile.weight),
		);
	}

	#commit(): ReaderFontStyleSnapshot {
		const settings = this.#preview ?? this.settings();
		const width = Math.max(360, this.#readReaderWidth());
		const displayScale = Math.min(1.1, Math.max(1, 0.73 + width / 4_000));
		const headerProgress = Math.min(
			1,
			Math.max(0, (width - 360) / (1_080 - 360)),
		);
		const interfaceScale =
			settings.fontProfile.interface / 100 * displayScale;
		const scaledPixels = (base: number) =>
			`${Math.round(base * interfaceScale * 100) / 100}px`;
		for (const [property, base] of Object.entries(
			INTERFACE_FONT_TOKEN_BASES,
		)) {
			this.#root.style.setProperty(property, scaledPixels(base));
		}
		const headerPixels = (minimum: number, maximum: number) =>
			`${Math.round((
				minimum + (maximum - minimum) * headerProgress
			) * settings.fontProfile.interface / 100 * 10) / 10}px`;
		this.#root.style.setProperty(
			'--ldp-reader-display-scale',
			String(displayScale),
		);
		this.#root.style.setProperty(
			'--ldp-reader-title-font-size',
			headerPixels(12, 16),
		);
		this.#root.style.setProperty(
			'--ldp-reader-meta-font-size',
			headerPixels(9, 11),
		);
		this.#root.style.setProperty(
			'--ldp-reader-topic-tag-font-size',
			headerPixels(9.5, 11),
		);
		this.#root.style.setProperty(
			'--ldp-post-font-size',
			`${Math.round(
				14 * settings.fontProfile.post / 100 * displayScale * 100,
			) / 100}px`,
		);
		this.#pageRoot.style.setProperty(
			'--ldp-composer-font-size',
			`${clampedInteger(
				settings.fontProfile.composer * displayScale,
				READER_FONT_DEFAULT.composer,
				READER_FONT_SCALE_LIMITS.min,
				READER_FONT_SCALE_LIMITS.max,
			)}%`,
		);
		this.#applyProfile(this.#root, settings.fontProfile);
		this.#applyProfile(this.#pageRoot, settings.fontProfile);

		const hostFamily = this.#fontFamily(
			settings.hostFontFamily,
			settings.hostFontCustomFamily,
		);
		if (settings.hostFontFamily === 'site') {
			this.#pageRoot.style.removeProperty('--ldp-host-font-family');
		} else {
			this.#pageRoot.style.setProperty(
				'--ldp-host-font-family',
				hostFamily,
			);
		}
		this.#pageRoot.style.setProperty(
			'--ldp-host-font-weight',
			String(settings.hostFontWeight),
		);
		if (settings.hostFontColor) {
			this.#pageRoot.style.setProperty(
				'--ldp-host-font-color',
				settings.hostFontColor,
			);
		} else {
			this.#pageRoot.style.removeProperty('--ldp-host-font-color');
		}
		for (const setting of HOST_SIZE_PROPERTIES) {
			const scale = settings[setting.key] / 100;
			for (const [property, base] of setting.values) {
				this.#pageRoot.style.setProperty(
					property,
					`${Math.round(base * scale * 10) / 10}px`,
				);
			}
		}

		this.#pageRoot.style.setProperty(
			'--ldp-font-rendering-stroke-runtime',
			`${this.#renderingDefaults.stroke}px currentcolor`,
		);
		this.#pageRoot.style.setProperty(
			'--ldp-font-rendering-shadow-runtime',
			`0 0 ${this.#renderingDefaults.shadow}px #7c7c7cdd`,
		);
		this.#pageRoot.toggleAttribute(
			'data-ldp-font-mac-smoothing',
			this.#renderingDefaults.macSmoothing,
		);
		const mode: ReaderFontRenderingMode =
			this.#readExternalFontRendering()
				? 'external'
				: settings.fontRenderingEnabled
					? 'builtin'
					: 'off';
		this.#root.dataset.ldpFontRendering = mode;
		this.#pageRoot.dataset.ldpFontRendering = mode;
		this.#pageRoot.dataset.ldpFontRenderingHost = String(
			mode === 'builtin' && settings.fontRenderingOnHost,
		);
		return Object.freeze({
			settings,
			mode,
			displayScale,
			previewing: this.#preview !== null,
		});
	}
}
