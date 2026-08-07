import { LifecycleScope } from '../kernel/lifecycle.js';
import type {
	ReaderPerformanceSnapshot,
} from '../app/reader-performance-policy.js';

export interface ReaderTopicNavigationPreferences {
	readonly jumpHighlightColor: string;
	readonly jumpHighlightRadius: number;
	readonly jumpHighlightBorderWidth: number;
	readonly jumpHighlightRate: number;
	readonly jumpHighlightCount: number;
}

export interface ReaderTopicNavigationPreferenceSnapshot {
	readonly overscanScreens: number;
	readonly maxMountedPostCount: number;
	readonly highlightColor: string;
	readonly highlightRadius: number;
	readonly highlightBorderWidth: number;
	readonly highlightRate: number;
	readonly highlightCount: number;
	readonly highlightStepDurationMs: number;
	readonly highlightLifetimeMs: number;
}

export interface ReaderTopicNavigationPreferenceProjectionOptions {
	readonly root: HTMLElement;
	readonly preferences: ReaderTopicNavigationPreferences;
	readonly readPerformance?: () => Pick<
		ReaderPerformanceSnapshot,
		'streamOverscanScreens' | 'streamMaxMountedPostCount'
	>;
	readonly parentScope?: LifecycleScope;
}

const VARIABLES = Object.freeze([
	'--ldp-jump-highlight-color',
	'--ldp-jump-highlight-radius',
	'--ldp-jump-highlight-border-width',
	'--ldp-jump-highlight-duration',
	'--ldp-jump-highlight-count',
] as const);

const DEFAULTS = Object.freeze({
	overscanScreens: 1.5,
	maxMountedPostCount: 80,
	highlightColor: '#0888cc',
	highlightRadius: 10,
	highlightBorderWidth: 1,
	highlightRate: 0.8,
	highlightCount: 2,
});

function finiteRange(
	value: number,
	fallback: number,
	minimum: number,
	maximum: number,
): number {
	return Number.isFinite(value)
		? Math.min(maximum, Math.max(minimum, value))
		: fallback;
}

function normalize(
	preferences: ReaderTopicNavigationPreferences,
	performance: Pick<
		ReaderPerformanceSnapshot,
		'streamOverscanScreens' | 'streamMaxMountedPostCount'
	> | null,
): ReaderTopicNavigationPreferenceSnapshot {
	const overscanScreens = finiteRange(
		performance?.streamOverscanScreens ?? DEFAULTS.overscanScreens,
		DEFAULTS.overscanScreens,
		0.25,
		3,
	);
	const maxMountedPostCount = Math.round(finiteRange(
		performance?.streamMaxMountedPostCount ?? DEFAULTS.maxMountedPostCount,
		DEFAULTS.maxMountedPostCount,
		24,
		128,
	));
	const highlightColor = /^#[0-9a-f]{6}$/i.test(preferences.jumpHighlightColor)
		? preferences.jumpHighlightColor.toLowerCase()
		: DEFAULTS.highlightColor;
	const highlightRadius = Math.round(finiteRange(
		preferences.jumpHighlightRadius,
		DEFAULTS.highlightRadius,
		0,
		24,
	));
	const highlightBorderWidth = Math.round(finiteRange(
		preferences.jumpHighlightBorderWidth,
		DEFAULTS.highlightBorderWidth,
		0,
		4,
	));
	const highlightRate = Math.round(
		finiteRange(
			preferences.jumpHighlightRate,
			DEFAULTS.highlightRate,
			0.5,
			2,
		) * 10,
	) / 10;
	const highlightCount = Math.round(finiteRange(
		preferences.jumpHighlightCount,
		DEFAULTS.highlightCount,
		1,
		6,
	));
	const highlightStepDurationMs = Math.round(1_000 / highlightRate);
	return Object.freeze({
		overscanScreens,
		maxMountedPostCount,
		highlightColor,
		highlightRadius,
		highlightBorderWidth,
		highlightRate,
		highlightCount,
		highlightStepDurationMs,
		highlightLifetimeMs: highlightStepDurationMs * highlightCount,
	});
}

function snapshotsEqual(
	left: ReaderTopicNavigationPreferenceSnapshot,
	right: ReaderTopicNavigationPreferenceSnapshot,
): boolean {
	return left.overscanScreens === right.overscanScreens &&
		left.maxMountedPostCount === right.maxMountedPostCount &&
		left.highlightColor === right.highlightColor &&
		left.highlightRadius === right.highlightRadius &&
		left.highlightBorderWidth === right.highlightBorderWidth &&
		left.highlightRate === right.highlightRate &&
		left.highlightCount === right.highlightCount &&
		left.highlightStepDurationMs === right.highlightStepDurationMs &&
		left.highlightLifetimeMs === right.highlightLifetimeMs;
}

/**
 * 导航性能和跳转提示偏好的唯一 DOM 投影。
 *
 * schema 仍是偏好真源；本类只维护当前规范化快照和 Shell root 的五个 CSS 变量。Topic
 * scroll adapter 通过窄读取方法消费同一快照，设置更新不重建 Topic、不扫描楼层 DOM。
 */
export class ReaderTopicNavigationPreferenceProjection {
	readonly scope: LifecycleScope;
	readonly #root: HTMLElement;
	readonly #readPerformance: () => Pick<
		ReaderPerformanceSnapshot,
		'streamOverscanScreens' | 'streamMaxMountedPostCount'
	> | null;
	readonly #previous = new Map<
		typeof VARIABLES[number],
		Readonly<{ value: string; priority: string }>
	>();
	#preferences: ReaderTopicNavigationPreferences;
	#preview: ReaderTopicNavigationPreferences | null = null;
	#snapshot: ReaderTopicNavigationPreferenceSnapshot;

	constructor(options: ReaderTopicNavigationPreferenceProjectionOptions) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#root = options.root;
		this.#readPerformance = options.readPerformance ?? (() => null);
		this.#preferences = options.preferences;
		for (const name of VARIABLES) {
			const readPriority = (
				this.#root.style as CSSStyleDeclaration & {
					getPropertyPriority?: (property: string) => string;
				}
			).getPropertyPriority;
			this.#previous.set(name, Object.freeze({
				value: this.#root.style.getPropertyValue(name),
				priority: typeof readPriority === 'function'
					? readPriority.call(this.#root.style, name)
					: '',
			}));
		}
		this.#snapshot = normalize(
			options.preferences,
			this.#readPerformance(),
		);
		this.#applyCss();
		this.scope.add(() => this.#restoreCss());
	}

	get snapshot(): ReaderTopicNavigationPreferenceSnapshot {
		return this.#snapshot;
	}

	apply(preferences: ReaderTopicNavigationPreferences): void {
		if (this.scope.destroyed) return;
		this.#preferences = preferences;
		this.#commit(normalize(
			this.#preview ?? this.#preferences,
			this.#readPerformance(),
		));
	}

	preview(preferences: ReaderTopicNavigationPreferences): void {
		if (this.scope.destroyed) return;
		const performance = this.#readPerformance();
		const snapshot = normalize(preferences, performance);
		this.#preview = snapshotsEqual(
			snapshot,
			normalize(this.#preferences, performance),
		) ? null : preferences;
		this.#commit(snapshot);
	}

	clearPreview(): void {
		if (this.scope.destroyed || !this.#preview) return;
		this.#preview = null;
		this.#commit(normalize(
			this.#preferences,
			this.#readPerformance(),
		));
	}

	refreshPerformance(): void {
		if (this.scope.destroyed) return;
		const performance = this.#readPerformance();
		this.#commit(Object.freeze({
			...this.#snapshot,
			overscanScreens: finiteRange(
				performance?.streamOverscanScreens ??
					DEFAULTS.overscanScreens,
				DEFAULTS.overscanScreens,
				0.25,
				3,
			),
			maxMountedPostCount: Math.round(finiteRange(
				performance?.streamMaxMountedPostCount ??
					DEFAULTS.maxMountedPostCount,
				DEFAULTS.maxMountedPostCount,
				24,
				128,
			)),
		}));
	}

	readOverscan(): Readonly<{
		readonly beforeScreens: number;
		readonly afterScreens: number;
	}> {
		const overscanScreens = this.#snapshot.overscanScreens;
		return Object.freeze({
			beforeScreens: overscanScreens,
			afterScreens: overscanScreens,
		});
	}

	readHighlightLifetimeMs(): number {
		return this.#snapshot.highlightLifetimeMs;
	}

	readMaxMountedPostCount(): number {
		return this.#snapshot.maxMountedPostCount;
	}

	destroy(): void {
		this.scope.destroy();
	}

	#commit(snapshot: ReaderTopicNavigationPreferenceSnapshot): void {
		if (snapshotsEqual(snapshot, this.#snapshot)) return;
		this.#snapshot = snapshot;
		this.#applyCss();
	}

	#applyCss(): void {
		const snapshot = this.#snapshot;
		this.#root.style.setProperty(
			'--ldp-jump-highlight-color',
			snapshot.highlightColor,
		);
		this.#root.style.setProperty(
			'--ldp-jump-highlight-radius',
			`${snapshot.highlightRadius}px`,
		);
		this.#root.style.setProperty(
			'--ldp-jump-highlight-border-width',
			`${snapshot.highlightBorderWidth}px`,
		);
		this.#root.style.setProperty(
			'--ldp-jump-highlight-duration',
			`${snapshot.highlightStepDurationMs}ms`,
		);
		this.#root.style.setProperty(
			'--ldp-jump-highlight-count',
			String(snapshot.highlightCount),
		);
	}

	#restoreCss(): void {
		for (const name of VARIABLES) {
			const previous = this.#previous.get(name);
			if (!previous?.value) this.#root.style.removeProperty(name);
			else this.#root.style.setProperty(
				name,
				previous.value,
				previous.priority,
			);
		}
	}
}
