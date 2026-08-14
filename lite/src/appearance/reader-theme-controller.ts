import {
	LifecycleScope,
	type Cleanup,
} from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import type { ReaderPreferences } from '../state/reader-preferences-schema.js';

export type ReaderThemeMode = 'light' | 'dark' | 'system';
export type ReaderResolvedTheme = Exclude<ReaderThemeMode, 'system'>;
export type ReaderAutoDarkStartTime = 'sunset' | string;

export interface ReaderAutoDarkSettings {
	readonly enabled: boolean;
	readonly startTime: ReaderAutoDarkStartTime;
}

export interface ReaderThemePreferencesAdapter<
	TPreferences extends object,
> {
	read(preferences: Readonly<TPreferences>): ReaderThemeMode;
	createPatch(mode: ReaderThemeMode): Partial<TPreferences>;
	readAutomatic(
		preferences: Readonly<TPreferences>,
	): ReaderAutoDarkSettings;
	createAutomaticPatch(
		settings: ReaderAutoDarkSettings,
	): Partial<TPreferences>;
}

export const readerPreferencesThemeAdapter:
ReaderThemePreferencesAdapter<ReaderPreferences> = Object.freeze({
	read: (preferences: Readonly<ReaderPreferences>) =>
		preferences.themeMode,
	createPatch: (themeMode: ReaderThemeMode) => ({ themeMode }),
	readAutomatic: (preferences: Readonly<ReaderPreferences>) =>
		Object.freeze({
			enabled: preferences.autoDarkModeEnabled,
			startTime: preferences.autoDarkModeStartTime,
		}),
	createAutomaticPatch: (settings: ReaderAutoDarkSettings) => ({
		autoDarkModeEnabled: settings.enabled,
		autoDarkModeStartTime: normalizeAutoDarkStartTime(
			settings.startTime,
		),
	}),
});

export interface ReaderSystemThemePort {
	readDark(): boolean;
	subscribe(
		listener: (dark: boolean) => void,
		scope: LifecycleScope,
	): Cleanup;
}

export interface ReaderHostThemePort {
	apply(mode: ReaderThemeMode): boolean;
	subscribe(
		listener: (mode: ReaderThemeMode) => void,
		scope: LifecycleScope,
	): Cleanup;
}

export interface ReaderLocalSunTimes {
	readonly sunriseMinutes: number;
	readonly sunsetMinutes: number;
	readonly source: 'location' | 'fallback';
}

export interface ReaderThemeClockPort {
	now(): Date;
	schedule(listener: () => void, delayMs: number): Cleanup;
	resolveSunTimes(date: Date): Promise<ReaderLocalSunTimes>;
	subscribe?(
		listener: () => void,
		scope: LifecycleScope,
	): Cleanup;
}

export interface ReaderAutoDarkSnapshot extends ReaderAutoDarkSettings {
	readonly active: boolean;
	readonly resolvedStartTime: string;
	readonly sunriseTime: string;
	readonly sunSource: ReaderLocalSunTimes['source'];
}

export interface ReaderThemeSnapshot {
	readonly mode: ReaderThemeMode;
	readonly resolved: ReaderResolvedTheme;
	readonly automatic: ReaderAutoDarkSnapshot;
}

export interface ReaderThemeControllerOptions<
	TPreferences extends object,
> {
	readonly root: HTMLElement;
	readonly preferences: ReaderThemePreferencesAdapter<TPreferences>;
	readonly readPreferences: () => Readonly<TPreferences>;
	readonly preferenceChanges: {
		subscribe(
			listener: (preferences: Readonly<TPreferences>) => void,
			scope: LifecycleScope,
		): Cleanup;
	};
	readonly system: ReaderSystemThemePort;
	readonly clock?: ReaderThemeClockPort;
	readonly parentScope?: LifecycleScope;
}

const MINUTES_PER_DAY = 24 * 60;
const FALLBACK_SUN_TIMES = Object.freeze<ReaderLocalSunTimes>({
	sunriseMinutes: 6 * 60,
	sunsetMinutes: 18 * 60,
	source: 'fallback',
});
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function normalizeAutoDarkStartTime(
	value: unknown,
): ReaderAutoDarkStartTime {
	const normalized = String(value ?? '').trim();
	return normalized === 'sunset' || TIME_PATTERN.test(normalized)
		? normalized
		: 'sunset';
}

function normalizeAutomatic(
	value: ReaderAutoDarkSettings,
): ReaderAutoDarkSettings {
	return Object.freeze({
		enabled: value.enabled === true,
		startTime: normalizeAutoDarkStartTime(value.startTime),
	});
}

function normalizeSunTimes(value: ReaderLocalSunTimes): ReaderLocalSunTimes {
	const validMinute = (minute: number): boolean =>
		Number.isFinite(minute) && minute >= 0 && minute < MINUTES_PER_DAY;
	return validMinute(value.sunriseMinutes) && validMinute(value.sunsetMinutes)
		? Object.freeze({
			sunriseMinutes: Math.round(value.sunriseMinutes),
			sunsetMinutes: Math.round(value.sunsetMinutes),
			source: value.source === 'location' ? 'location' : 'fallback',
		})
		: FALLBACK_SUN_TIMES;
}

function minutesFromTime(value: string): number {
	const [hours, minutes] = value.split(':').map(Number);
	return hours! * 60 + minutes!;
}

function formattedMinutes(value: number): string {
	const normalized = Math.round(value) % MINUTES_PER_DAY;
	return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:` +
		`${String(normalized % 60).padStart(2, '0')}`;
}

function localDateKey(date: Date): string {
	return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function automaticDarkActive(
	date: Date,
	startMinutes: number,
	sunriseMinutes: number,
): boolean {
	const currentMinutes =
		date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
	return startMinutes >= sunriseMinutes
		? currentMinutes >= startMinutes || currentMinutes < sunriseMinutes
		: currentMinutes >= startMinutes && currentMinutes < sunriseMinutes;
}

function nextBoundaryDelay(
	date: Date,
	startMinutes: number,
	sunriseMinutes: number,
): number {
	const boundary = (minutes: number): number => {
		let next = new Date(
			date.getFullYear(),
			date.getMonth(),
			date.getDate(),
			Math.floor(minutes / 60),
			minutes % 60,
			0,
			50,
		);
		if (next.getTime() <= date.getTime() + 50) {
			next = new Date(
				date.getFullYear(),
				date.getMonth(),
				date.getDate() + 1,
				Math.floor(minutes / 60),
				minutes % 60,
				0,
				50,
			);
		}
		return next.getTime() - date.getTime();
	};
	const midnight = new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate() + 1,
	).getTime() - date.getTime() + 50;
	return Math.max(250, Math.min(
		boundary(startMinutes),
		boundary(sunriseMinutes),
		midnight,
	));
}

function defaultClock(): ReaderThemeClockPort {
	return Object.freeze({
		now: () => new Date(),
		schedule(listener: () => void, delayMs: number) {
			const timer = setTimeout(listener, delayMs);
			return () => clearTimeout(timer);
		},
		resolveSunTimes: async () => FALLBACK_SUN_TIMES,
	});
}

function normalizeMode(value: unknown): ReaderThemeMode {
	return value === 'light' || value === 'dark' ? value : 'system';
}

function sameSnapshot(
	left: ReaderThemeSnapshot,
	right: ReaderThemeSnapshot,
): boolean {
	return left.mode === right.mode &&
		left.resolved === right.resolved &&
		left.automatic.enabled === right.automatic.enabled &&
		left.automatic.startTime === right.automatic.startTime &&
		left.automatic.active === right.automatic.active &&
		left.automatic.resolvedStartTime ===
			right.automatic.resolvedStartTime &&
		left.automatic.sunriseTime === right.automatic.sunriseTime &&
		left.automatic.sunSource === right.automatic.sunSource;
}

/**
 * Reader 自有明暗主题的唯一状态与 DOM owner。
 *
 * 它只在 Reader root 上投影 mode/resolved theme，不修改 Discourse 的 html/body 主题。
 * 宿主主题切换由设置控件消费独立 ReaderHostThemePort；所有颜色由 Lite CSS 的语义变量
 * 消费，外观 controller 只读取这里解析后的明暗结果，不再从宿主主题猜测 Reader 自有主题。
 */
export class ReaderThemeController<TPreferences extends object> {
	readonly scope: LifecycleScope;
	readonly changes = new Signal<ReaderThemeSnapshot>();
	readonly #root: HTMLElement;
	readonly #adapter: ReaderThemePreferencesAdapter<TPreferences>;
	readonly #system: ReaderSystemThemePort;
	readonly #clock: ReaderThemeClockPort;
	readonly #originalMode: string | undefined;
	readonly #originalTheme: string | undefined;
	readonly #originalAutomatic: string | undefined;
	readonly #originalColorScheme: string;
	#preferences: Readonly<TPreferences>;
	#systemDark: boolean;
	#sunTimes = FALLBACK_SUN_TIMES;
	#sunDateKey = '';
	#sunTimesResolved = false;
	#sunRequestKey = '';
	#sunRequestToken = 0;
	#automaticTimer: Cleanup | null = null;
	#snapshot: ReaderThemeSnapshot;

	constructor(options: ReaderThemeControllerOptions<TPreferences>) {
		this.#root = options.root;
		this.#adapter = options.preferences;
		this.#system = options.system;
		this.#clock = options.clock ?? defaultClock();
		this.#preferences = options.readPreferences();
		this.#systemDark = this.#system.readDark();
		this.#originalMode = this.#root.dataset.ldpThemeMode;
		this.#originalTheme = this.#root.dataset.ldpTheme;
		this.#originalAutomatic = this.#root.dataset.ldpThemeAutomatic;
		this.#originalColorScheme = this.#root.style.colorScheme;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#sunDateKey = localDateKey(this.#clock.now());
		this.#snapshot = this.#derive();
		this.#project(this.#snapshot);

		options.preferenceChanges.subscribe((preferences) => {
			this.#preferences = preferences;
			this.#refreshAutomaticSchedule();
		}, this.scope);
		this.#system.subscribe((dark) => {
			this.#systemDark = Boolean(dark);
			this.#publish();
		}, this.scope);
		this.#clock.subscribe?.(
			() => this.#refreshAutomaticSchedule(),
			this.scope,
		);
		this.scope.add(() => {
			this.#sunRequestToken += 1;
			this.#cancelAutomaticTimer();
			this.changes.clear();
			if (this.#originalMode === undefined) {
				delete this.#root.dataset.ldpThemeMode;
			} else {
				this.#root.dataset.ldpThemeMode = this.#originalMode;
			}
			if (this.#originalTheme === undefined) {
				delete this.#root.dataset.ldpTheme;
			} else {
				this.#root.dataset.ldpTheme = this.#originalTheme;
			}
			if (this.#originalAutomatic === undefined) {
				delete this.#root.dataset.ldpThemeAutomatic;
			} else {
				this.#root.dataset.ldpThemeAutomatic = this.#originalAutomatic;
			}
			this.#root.style.colorScheme = this.#originalColorScheme;
		});
		this.#refreshAutomaticSchedule();
	}

	get snapshot(): ReaderThemeSnapshot {
		return this.#snapshot;
	}

	readMode(preferences: Readonly<TPreferences>): ReaderThemeMode {
		return normalizeMode(this.#adapter.read(preferences));
	}

	createPatch(mode: ReaderThemeMode): Partial<TPreferences> {
		return this.#adapter.createPatch(normalizeMode(mode));
	}

	readAutomatic(
		preferences: Readonly<TPreferences>,
	): ReaderAutoDarkSettings {
		return normalizeAutomatic(this.#adapter.readAutomatic(preferences));
	}

	createAutomaticPatch(
		settings: ReaderAutoDarkSettings,
	): Partial<TPreferences> {
		return this.#adapter.createAutomaticPatch(
			normalizeAutomatic(settings),
		);
	}

	destroy(): void {
		this.scope.destroy();
	}

	#derive(): ReaderThemeSnapshot {
		const mode = this.readMode(this.#preferences);
		const automatic = this.readAutomatic(this.#preferences);
		const startMinutes = automatic.startTime === 'sunset'
			? this.#sunTimes.sunsetMinutes
			: minutesFromTime(automatic.startTime);
		const active = automatic.enabled && automaticDarkActive(
			this.#clock.now(),
			startMinutes,
			this.#sunTimes.sunriseMinutes,
		);
		const base = mode === 'system'
			? this.#systemDark ? 'dark' : 'light'
			: mode;
		return Object.freeze({
			mode,
			resolved: active ? 'dark' : base,
			automatic: Object.freeze({
				...automatic,
				active,
				resolvedStartTime: formattedMinutes(startMinutes),
				sunriseTime: formattedMinutes(this.#sunTimes.sunriseMinutes),
				sunSource: this.#sunTimes.source,
			}),
		});
	}

	#refreshAutomaticSchedule(): void {
		if (this.scope.destroyed) return;
		this.#cancelAutomaticTimer();
		const automatic = this.readAutomatic(this.#preferences);
		if (!automatic.enabled) {
			this.#publish();
			return;
		}
		const now = this.#clock.now();
		const dateKey = localDateKey(now);
		if (dateKey !== this.#sunDateKey) {
			this.#sunDateKey = dateKey;
			this.#sunTimes = FALLBACK_SUN_TIMES;
			this.#sunTimesResolved = false;
		}
		if (!this.#sunTimesResolved && this.#sunRequestKey !== dateKey) {
			this.#resolveSunTimes(now, dateKey);
		}
		this.#publish();
		const startMinutes = automatic.startTime === 'sunset'
			? this.#sunTimes.sunsetMinutes
			: minutesFromTime(automatic.startTime);
		this.#automaticTimer = this.#clock.schedule(
			() => {
				this.#automaticTimer = null;
				this.#refreshAutomaticSchedule();
			},
			nextBoundaryDelay(
				now,
				startMinutes,
				this.#sunTimes.sunriseMinutes,
			),
		);
	}

	#resolveSunTimes(date: Date, dateKey: string): void {
		this.#sunRequestKey = dateKey;
		const token = ++this.#sunRequestToken;
		this.#clock.resolveSunTimes(date).then(
			(value) => {
				if (
					this.scope.destroyed ||
					token !== this.#sunRequestToken ||
					dateKey !== this.#sunDateKey
				) return;
				this.#sunRequestKey = '';
				this.#sunTimesResolved = true;
				this.#sunTimes = normalizeSunTimes(value);
				this.#refreshAutomaticSchedule();
			},
			() => {
				if (
					this.scope.destroyed ||
					token !== this.#sunRequestToken ||
					dateKey !== this.#sunDateKey
				) return;
				this.#sunRequestKey = '';
				this.#sunTimesResolved = true;
				this.#sunTimes = FALLBACK_SUN_TIMES;
				this.#refreshAutomaticSchedule();
			},
		);
	}

	#cancelAutomaticTimer(): void {
		this.#automaticTimer?.();
		this.#automaticTimer = null;
	}

	#publish(): void {
		if (this.scope.destroyed) return;
		const next = this.#derive();
		if (sameSnapshot(next, this.#snapshot)) return;
		this.#snapshot = next;
		this.#project(next);
		this.changes.emit(next);
	}

	#project(snapshot: ReaderThemeSnapshot): void {
		this.#root.dataset.ldpThemeMode = snapshot.mode;
		this.#root.dataset.ldpTheme = snapshot.resolved;
		this.#root.dataset.ldpThemeAutomatic = snapshot.automatic.enabled
			? snapshot.automatic.active ? 'active' : 'scheduled'
			: 'off';
		this.#root.style.colorScheme = snapshot.resolved;
	}
}
