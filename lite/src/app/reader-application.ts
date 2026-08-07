import {
	LifecycleScope,
	type Cleanup,
} from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';

export type ReaderApplicationState =
	| 'idle'
	| 'waiting-body'
	| 'waiting-host'
	| 'starting'
	| 'running'
	| 'skipped'
	| 'failed'
	| 'destroyed';

export interface DiscourseHostDescriptor {
	readonly detection: 'native-module' | 'dom-marker';
}

export interface DiscourseHostPort {
	waitForHost(signal: AbortSignal): Promise<DiscourseHostDescriptor | null>;
}

export interface ReaderApplicationPreferencesPort<TPreferences extends object> {
	load(): { readonly value: Readonly<TPreferences> };
	update?(
		patch: Partial<TPreferences>,
	): { readonly value: Readonly<TPreferences> };
	readonly changes?: Pick<
		Signal<{ readonly value: Readonly<TPreferences> }>,
		'subscribe'
	>;
}

export interface ReaderApplicationContext<TPreferences extends object> {
	readonly preferences: Readonly<TPreferences>;
	readonly readPreferences: () => Readonly<TPreferences>;
	readonly updatePreferences?: (
		patch: Partial<TPreferences>,
	) => Readonly<TPreferences>;
	readonly preferenceChanges: Signal<Readonly<TPreferences>>;
	readonly host: DiscourseHostDescriptor;
}

export interface ReaderApplicationStage<TPreferences extends object> {
	readonly name: string;
	readonly required: boolean;
	setup(
		scope: LifecycleScope,
		context: ReaderApplicationContext<TPreferences>,
	): void | Cleanup | Promise<void | Cleanup>;
}

export interface ReaderApplicationDiagnostic {
	readonly stage: string;
	readonly required: boolean;
	readonly cause: unknown;
}

export interface ReaderApplicationOptions<TPreferences extends object> {
	readonly bodyReady: (signal: AbortSignal) => Promise<void>;
	readonly host: DiscourseHostPort;
	readonly preferences: ReaderApplicationPreferencesPort<TPreferences>;
	readonly stages: readonly ReaderApplicationStage<TPreferences>[];
}

export interface BrowserDiscourseHostPortOptions {
	readonly moduleLookup: (name: string) => unknown;
	readonly document?: Document;
	readonly window?: Window;
	readonly timeoutMs?: number;
	readonly createObserver?: (
		callback: MutationCallback,
	) => Pick<MutationObserver, 'observe' | 'disconnect'>;
}

function abortError(reason: unknown): Error {
	if (reason instanceof Error) return reason;
	return new DOMException('Reader application 已销毁', 'AbortError');
}

function stageName(value: string): string {
	const normalized = String(value).trim();
	if (!normalized) throw new Error('application stage name 不能为空');
	return normalized;
}

/**
 * Reader 全局启动与 application scope 的唯一 owner。
 */
export class ReaderApplication<TPreferences extends object> {
	readonly changes = new Signal<ReaderApplicationState>();
	readonly diagnostics = new Signal<ReaderApplicationDiagnostic>();
	readonly #options: ReaderApplicationOptions<TPreferences>;
	readonly #scope = new LifecycleScope();
	readonly #controller = new AbortController();
	#state: ReaderApplicationState = 'idle';
	#startPromise: Promise<ReaderApplicationState> | null = null;

	constructor(options: ReaderApplicationOptions<TPreferences>) {
		const names = options.stages.map((stage) => stageName(stage.name));
		if (new Set(names).size !== names.length) {
			throw new Error('application stage name 不能重复');
		}
		this.#options = options;
		this.#scope.add(() => {
			if (!this.#controller.signal.aborted) {
				this.#controller.abort(abortError(null));
			}
		});
	}

	get state(): ReaderApplicationState {
		return this.#state;
	}

	get scope(): LifecycleScope {
		return this.#scope;
	}

	start(): Promise<ReaderApplicationState> {
		if (this.#startPromise) return this.#startPromise;
		if (this.#state === 'destroyed') {
			return Promise.resolve('destroyed');
		}
		this.#startPromise = this.#run();
		return this.#startPromise;
	}

	destroy(): void {
		if (this.#state === 'destroyed') return;
		this.#setState('destroyed');
		this.#scope.destroy();
	}

	async #run(): Promise<ReaderApplicationState> {
		try {
			this.#setState('waiting-body');
			await this.#options.bodyReady(this.#controller.signal);
			this.#throwIfDestroyed();

			let preferences = this.#options.preferences.load().value;
			const preferenceChanges = new Signal<Readonly<TPreferences>>();
			this.#scope.add(() => preferenceChanges.clear());
			const publishPreferences = (
				value: Readonly<TPreferences>,
			): void => {
				if (preferences === value) return;
				preferences = value;
				for (const cause of preferenceChanges.emit(preferences)) {
					this.diagnostics.emit(Object.freeze({
						stage: 'preferences-live',
						required: false,
						cause,
					}));
				}
			};
			const stopPreferenceChanges =
				this.#options.preferences.changes?.subscribe((snapshot) => {
					publishPreferences(snapshot.value);
				}, this.#scope);
			this.#setState('waiting-host');
			const host = await this.#options.host.waitForHost(this.#controller.signal);
			this.#throwIfDestroyed();
			if (!host) {
				stopPreferenceChanges?.();
				this.#setState('skipped');
				return this.#state;
			}

			this.#setState('starting');
			const context = Object.freeze({
				preferences,
				readPreferences: () => preferences,
				...(this.#options.preferences.update === undefined
					? {}
					: {
						updatePreferences: (
							patch: Partial<TPreferences>,
						): Readonly<TPreferences> => {
							this.#throwIfDestroyed();
							const snapshot =
								this.#options.preferences.update!(patch);
							publishPreferences(snapshot.value);
							return snapshot.value;
						},
					}),
				preferenceChanges,
				host,
			});
			for (const stage of this.#options.stages) {
				this.#throwIfDestroyed();
				const child = this.#scope.child();
				try {
					const cleanup = await stage.setup(child, context);
					if (typeof cleanup === 'function') child.add(cleanup);
					this.#throwIfDestroyed();
				} catch (cause) {
					try {
						child.destroy();
					} catch (cleanupCause) {
						this.diagnostics.emit(Object.freeze({
							stage: `${stage.name}:cleanup`,
							required: stage.required,
							cause: cleanupCause,
						}));
					}
					this.diagnostics.emit(Object.freeze({
						stage: stage.name,
						required: stage.required,
						cause,
					}));
					if (stage.required) throw cause;
				}
			}
			this.#throwIfDestroyed();
			this.#setState('running');
			return this.#state;
		} catch {
			if (this.#state === 'destroyed' || this.#controller.signal.aborted) {
				return 'destroyed';
			}
			this.#setState('failed');
			try {
				this.#scope.destroy();
			} catch (cleanupCause) {
				this.diagnostics.emit(Object.freeze({
					stage: 'application:cleanup',
					required: true,
					cause: cleanupCause,
				}));
			}
			return this.#state;
		}
	}

	#throwIfDestroyed(): void {
		if (this.#state === 'destroyed' || this.#controller.signal.aborted) {
			throw abortError(this.#controller.signal.reason);
		}
	}

	#setState(state: ReaderApplicationState): void {
		if (this.#state === state) return;
		this.#state = state;
		this.changes.emit(state);
	}
}

export function detectDiscourseHost(
	moduleLookup: (name: string) => unknown,
	documentPort: Pick<Document, 'querySelector'>,
): DiscourseHostDescriptor | null {
	try {
		if (moduleLookup('discourse/lib/url')) {
			return Object.freeze({ detection: 'native-module' });
		}
	} catch {
		// 原生 module lookup 不可用时，仅降级做站点识别，不发送探测请求。
	}
	if (
		documentPort.querySelector(
			'meta[name="generator"][content*="Discourse" i],meta[name="discourse_theme_id"],#data-preloaded,' +
			'#ember-app .d-header,#ember-app .topic-list,#ember-app .topic-post',
		)
	) {
		return Object.freeze({ detection: 'dom-marker' });
	}
	return null;
}

/**
 * 浏览器宿主等待端口。只观察原生 module/DOM marker，不通过 HTTP 猜测 Discourse。
 */
export class BrowserDiscourseHostPort implements DiscourseHostPort {
	readonly #moduleLookup: (name: string) => unknown;
	readonly #document: Document;
	readonly #window: Window;
	readonly #timeoutMs: number;
	readonly #createObserver: BrowserDiscourseHostPortOptions['createObserver'];

	constructor(options: BrowserDiscourseHostPortOptions) {
		this.#moduleLookup = options.moduleLookup;
		this.#document = options.document ?? document;
		this.#window = options.window ?? window;
		const timeoutMs = options.timeoutMs ?? 15_000;
		if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
			throw new RangeError('Discourse host timeout 必须是 1..120000 的安全整数');
		}
		this.#timeoutMs = timeoutMs;
		this.#createObserver = options.createObserver ??
			((callback) => new MutationObserver(callback));
	}

	waitForHost(signal: AbortSignal): Promise<DiscourseHostDescriptor | null> {
		const immediate = detectDiscourseHost(this.#moduleLookup, this.#document);
		if (immediate) return Promise.resolve(immediate);
		if (signal.aborted) return Promise.reject(abortError(signal.reason));
		return new Promise((resolve, reject) => {
			let settled = false;
			let timer = 0;
			const observer = this.#createObserver?.(() => check());
			const cleanup = (): void => {
				if (timer) this.#window.clearTimeout(timer);
				observer?.disconnect();
				this.#window.removeEventListener('load', check);
				signal.removeEventListener('abort', onAbort);
			};
			const finish = (value: DiscourseHostDescriptor | null): void => {
				if (settled) return;
				settled = true;
				cleanup();
				resolve(value);
			};
			const check = (): void => {
				const detected = detectDiscourseHost(this.#moduleLookup, this.#document);
				if (detected) finish(detected);
			};
			const onAbort = (): void => {
				if (settled) return;
				settled = true;
				cleanup();
				reject(abortError(signal.reason));
			};
			observer?.observe(this.#document.documentElement, {
				childList: true,
				subtree: true,
			});
			this.#window.addEventListener('load', check);
			signal.addEventListener('abort', onAbort, { once: true });
			timer = this.#window.setTimeout(() => {
				finish(detectDiscourseHost(this.#moduleLookup, this.#document));
			}, this.#timeoutMs);
		});
	}
}

export function browserBodyReady(
	documentPort: Pick<Document, 'body' | 'addEventListener' | 'removeEventListener'>,
	signal: AbortSignal,
): Promise<void> {
	if (documentPort.body) return Promise.resolve();
	if (signal.aborted) return Promise.reject(abortError(signal.reason));
	return new Promise<void>((resolve, reject) => {
		const cleanup = (): void => {
			documentPort.removeEventListener('DOMContentLoaded', onReady);
			signal.removeEventListener('abort', onAbort);
		};
		const onReady = (): void => {
			cleanup();
			resolve();
		};
		const onAbort = (): void => {
			cleanup();
			reject(abortError(signal.reason));
		};
		documentPort.addEventListener('DOMContentLoaded', onReady, { once: true });
		signal.addEventListener('abort', onAbort, { once: true });
	});
}
