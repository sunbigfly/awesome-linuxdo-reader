import {
	LifecycleScope,
	type Cleanup,
} from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import type { ReaderPreferences } from '../state/reader-preferences-schema.js';

export type ReaderThemeMode = 'light' | 'dark' | 'system';
export type ReaderResolvedTheme = Exclude<ReaderThemeMode, 'system'>;

export interface ReaderThemePreferencesAdapter<
	TPreferences extends object,
> {
	read(preferences: Readonly<TPreferences>): ReaderThemeMode;
	createPatch(mode: ReaderThemeMode): Partial<TPreferences>;
}

export const readerPreferencesThemeAdapter:
ReaderThemePreferencesAdapter<ReaderPreferences> = Object.freeze({
	read: (preferences: Readonly<ReaderPreferences>) =>
		preferences.themeMode,
	createPatch: (themeMode: ReaderThemeMode) => ({ themeMode }),
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

export interface ReaderThemeSnapshot {
	readonly mode: ReaderThemeMode;
	readonly resolved: ReaderResolvedTheme;
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
	readonly parentScope?: LifecycleScope;
}

function normalizeMode(value: unknown): ReaderThemeMode {
	return value === 'light' || value === 'dark' ? value : 'system';
}

function sameSnapshot(
	left: ReaderThemeSnapshot,
	right: ReaderThemeSnapshot,
): boolean {
	return left.mode === right.mode && left.resolved === right.resolved;
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
	readonly #originalMode: string | undefined;
	readonly #originalTheme: string | undefined;
	readonly #originalColorScheme: string;
	#preferences: Readonly<TPreferences>;
	#systemDark: boolean;
	#snapshot: ReaderThemeSnapshot;

	constructor(options: ReaderThemeControllerOptions<TPreferences>) {
		this.#root = options.root;
		this.#adapter = options.preferences;
		this.#system = options.system;
		this.#preferences = options.readPreferences();
		this.#systemDark = this.#system.readDark();
		this.#originalMode = this.#root.dataset.ldpThemeMode;
		this.#originalTheme = this.#root.dataset.ldpTheme;
		this.#originalColorScheme = this.#root.style.colorScheme;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#snapshot = this.#derive();
		this.#project(this.#snapshot);

		options.preferenceChanges.subscribe((preferences) => {
			this.#preferences = preferences;
			this.#publish();
		}, this.scope);
		this.#system.subscribe((dark) => {
			this.#systemDark = Boolean(dark);
			this.#publish();
		}, this.scope);
		this.scope.add(() => {
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
			this.#root.style.colorScheme = this.#originalColorScheme;
		});
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

	destroy(): void {
		this.scope.destroy();
	}

	#derive(): ReaderThemeSnapshot {
		const mode = this.readMode(this.#preferences);
		return Object.freeze({
			mode,
			resolved:
				mode === 'system'
					? this.#systemDark ? 'dark' : 'light'
					: mode,
		});
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
		this.#root.style.colorScheme = snapshot.resolved;
	}
}
