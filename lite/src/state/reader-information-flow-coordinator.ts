import type {
	ResponseCacheInvalidation,
} from '../cache/response-repository.js';
import {
	LifecycleScope,
	type Cleanup,
} from '../kernel/lifecycle.js';

export const READER_INFORMATION_FLOW_INVENTORY = Object.freeze([
	Object.freeze({ domain: 'preferences', transport: 'web-storage' }),
	Object.freeze({ domain: 'reading-history', transport: 'web-storage' }),
	Object.freeze({ domain: 'chronicle', transport: 'web-storage' }),
	Object.freeze({ domain: 'unwanted-topics', transport: 'web-storage' }),
	Object.freeze({ domain: 'reader-queue', transport: 'web-storage' }),
	Object.freeze({ domain: 'user-observations', transport: 'web-storage+cache' }),
	Object.freeze({ domain: 'host-opened-topics', transport: 'web-storage' }),
	Object.freeze({ domain: 'topic-context', transport: 'userscript-value' }),
	Object.freeze({ domain: 'topic-summary-state', transport: 'web-storage' }),
	Object.freeze({ domain: 'surface-layout', transport: 'web-storage' }),
	Object.freeze({ domain: 'connect-trust-history', transport: 'web-storage' }),
	Object.freeze({ domain: 'credit-account', transport: 'userscript-value' }),
	Object.freeze({ domain: 'notifications', transport: 'cache-broadcast' }),
	Object.freeze({ domain: 'bookmarks', transport: 'cache-broadcast' }),
	Object.freeze({ domain: 'download-history', transport: 'cache-broadcast' }),
	Object.freeze({ domain: 'custom-sites', transport: 'userscript-value' }),
	Object.freeze({ domain: 'translation-config', transport: 'userscript-value' }),
	Object.freeze({ domain: 'webdav-config', transport: 'userscript-value' }),
	Object.freeze({ domain: 'response-cache', transport: 'cache-broadcast' }),
	Object.freeze({ domain: 'read-confirmations', transport: 'read-broadcast' }),
] as const);

/**
 * 反向扫描持久写入口后确认不能作为共享业务信息广播的状态。
 * 这些 key 只拥有协议协调或一次性事务语义；跨标签投影反而会破坏其 owner 边界。
 */
export const READER_INFORMATION_FLOW_EXCLUSIONS = Object.freeze([
	Object.freeze({
		domain: 'request-permit',
		reason: '跨标签请求许可协议已自行协调，不是用户可见信息',
	}),
	Object.freeze({
		domain: 'cache-flight-lock',
		reason: '缓存单飞租约只属于并发协议，不得投影到业务界面',
	}),
	Object.freeze({
		domain: 'embedded-reload-transaction',
		reason: '仅供当前标签真实 reload 一次性消费，广播会串用导航事务',
	}),
	Object.freeze({
		domain: 'native-tab-bypass',
		reason: '新标签原生打开绕过标记只能由目标标签一次性消费',
	}),
	Object.freeze({
		domain: 'account-scope-migration-metadata',
		reason: '旧 key 归属标记只服务迁移判定，对应业务数据域已独立接线',
	}),
	Object.freeze({
		domain: 'asset-cache',
		reason: 'CacheStorage 二进制资源没有存活期业务投影，按 URL 命中即可',
	}),
	Object.freeze({
		domain: 'settings-reset-reminder',
		reason: '升级提醒只在启动时判定，没有存活期数据消费者',
	}),
] as const);

export type ReaderInformationFlowDomain =
	(typeof READER_INFORMATION_FLOW_INVENTORY)[number]['domain'];

export type ReaderInformationFlowSource =
	| 'storage'
	| 'cache'
	| 'userscript-value';

export interface ReaderInformationFlowDiagnostic {
	readonly domain: ReaderInformationFlowDomain;
	readonly source: ReaderInformationFlowSource;
	readonly cause: unknown;
}

export interface ReaderInformationFlowCachePort {
	subscribeInvalidation(
		listener: (query: ResponseCacheInvalidation) => void,
	): Cleanup;
}

export interface ReaderInformationFlowRegistration {
	readonly domain: ReaderInformationFlowDomain;
	readonly storageKeys?: readonly string[];
	readonly storageKeyPrefixes?: readonly string[];
	readonly cacheIds?: readonly string[];
	readonly cacheIdPrefixes?: readonly string[];
	readonly cacheKinds?: readonly string[];
	readonly cacheTags?: readonly string[];
	readonly subscriptions?: readonly Readonly<{
		readonly source: Exclude<ReaderInformationFlowSource, 'storage' | 'cache'>;
		readonly subscribe: (notify: () => void) => Cleanup;
	}>[];
	readonly refresh: (
		source: ReaderInformationFlowSource,
	) => unknown;
}

export interface ReaderInformationFlowCoordinatorOptions {
	readonly storageEvents?: EventTarget | null;
	readonly cache?: ReaderInformationFlowCachePort | null;
	readonly schedule?: (callback: () => void) => void;
	readonly parentScope?: LifecycleScope;
	readonly onDiagnostic?: (
		diagnostic: ReaderInformationFlowDiagnostic,
	) => void;
}

interface RefreshState {
	scheduled: boolean;
	running: boolean;
	rerun: boolean;
	source: ReaderInformationFlowSource;
}

function tokens(values: readonly string[] | undefined): readonly string[] {
	return Object.freeze([
		...new Set((values ?? []).map(String).map((value) => value.trim()).filter(Boolean)),
	]);
}

function cacheMatches(
	registration: ReaderInformationFlowRegistration,
	query: ResponseCacheInvalidation,
): boolean {
	if (query.all) return true;
	const ids = query.ids ?? [];
	if (registration.cacheIds?.some((id) => ids.includes(id))) return true;
	if (registration.cacheIdPrefixes?.some((prefix) =>
		ids.some((id) => id.startsWith(prefix)))) return true;
	if (registration.cacheKinds?.some((kind) => query.kinds?.includes(kind))) {
		return true;
	}
	return registration.cacheTags?.some((tag) => query.tags?.includes(tag)) === true;
}

/**
 * 跨标签业务信息刷新入口的唯一调度器。
 *
 * 浏览器 storage 事件与中央缓存广播仍各自拥有 transport；本类只把它们归一成领域
 * 回调，并把同一 tick 或在飞期间的重复消息合并为至多一次补跑。回调只重读本地持久
 * owner，不拥有页面刷新、网络请求或业务合并规则。
 */
export class ReaderInformationFlowCoordinator {
	readonly scope: LifecycleScope;
	readonly #registrations = new Map<
		ReaderInformationFlowDomain,
		ReaderInformationFlowRegistration
	>();
	readonly #states = new Map<ReaderInformationFlowDomain, RefreshState>();
	readonly #schedule: (callback: () => void) => void;
	readonly #onDiagnostic: (
		diagnostic: ReaderInformationFlowDiagnostic,
	) => void;

	constructor(options: ReaderInformationFlowCoordinatorOptions = {}) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#schedule = options.schedule ?? queueMicrotask;
		this.#onDiagnostic = options.onDiagnostic ?? (() => {});
		if (options.storageEvents) {
			this.scope.listen(options.storageEvents, 'storage', (rawEvent) => {
				const event = rawEvent as StorageEvent;
				if (event.key !== null && event.oldValue === event.newValue) return;
				for (const registration of this.#registrations.values()) {
					if (
						(registration.storageKeys?.length ||
							registration.storageKeyPrefixes?.length) &&
						(event.key === null ||
							registration.storageKeys?.includes(event.key) === true ||
							registration.storageKeyPrefixes?.some((prefix) =>
								event.key?.startsWith(prefix)) === true)
					) this.#enqueue(registration.domain, 'storage');
				}
			});
		}
		if (options.cache) {
			this.connectCache(options.cache);
		}
		this.scope.add(() => {
			this.#registrations.clear();
			this.#states.clear();
		});
	}

	register(input: ReaderInformationFlowRegistration): Cleanup {
		if (this.scope.destroyed) return () => {};
		if (this.#registrations.has(input.domain)) {
			throw new Error(`信息流领域 ${input.domain} 已注册`);
		}
		const registration = Object.freeze({
			...input,
			storageKeys: tokens(input.storageKeys),
			storageKeyPrefixes: tokens(input.storageKeyPrefixes),
			cacheIds: tokens(input.cacheIds),
			cacheIdPrefixes: tokens(input.cacheIdPrefixes),
			cacheKinds: tokens(input.cacheKinds),
			cacheTags: tokens(input.cacheTags),
		});
		if (
			!registration.storageKeys.length &&
			!registration.storageKeyPrefixes.length &&
			!registration.cacheIds.length &&
			!registration.cacheIdPrefixes.length &&
			!registration.cacheKinds.length &&
			!registration.cacheTags.length &&
			!registration.subscriptions?.length
		) throw new Error(`信息流领域 ${input.domain} 缺少事件入口`);
		this.#registrations.set(input.domain, registration);
		this.#states.set(input.domain, {
			scheduled: false,
			running: false,
			rerun: false,
			source: 'storage',
		});
		const subscriptionCleanups = registration.subscriptions?.map((binding) =>
			binding.subscribe(() => this.#enqueue(input.domain, binding.source))) ?? [];
		let active = true;
		const cleanup = (): void => {
			if (!active) return;
			active = false;
			for (const release of subscriptionCleanups) release();
			if (this.#registrations.get(input.domain) === registration) {
				this.#registrations.delete(input.domain);
				this.#states.delete(input.domain);
			}
		};
		this.scope.add(cleanup);
		return cleanup;
	}

	connectCache(cache: ReaderInformationFlowCachePort): Cleanup {
		if (this.scope.destroyed) return () => {};
		let active = true;
		const release = cache.subscribeInvalidation((query) => {
			if (!active) return;
			for (const registration of this.#registrations.values()) {
				if (cacheMatches(registration, query)) {
					this.#enqueue(registration.domain, 'cache');
				}
			}
		});
		const cleanup = (): void => {
			if (!active) return;
			active = false;
			release();
		};
		this.scope.add(cleanup);
		return cleanup;
	}

	registeredDomains(): readonly ReaderInformationFlowDomain[] {
		return Object.freeze([...this.#registrations.keys()]);
	}

	destroy(): void {
		this.scope.destroy();
	}

	#enqueue(
		domain: ReaderInformationFlowDomain,
		source: ReaderInformationFlowSource,
	): void {
		const state = this.#states.get(domain);
		if (!state || this.scope.destroyed) return;
		state.source = source;
		if (state.running) {
			state.rerun = true;
			return;
		}
		if (state.scheduled) return;
		state.scheduled = true;
		this.#schedule(() => {
			void this.#drain(domain);
		});
	}

	async #drain(domain: ReaderInformationFlowDomain): Promise<void> {
		const state = this.#states.get(domain);
		const registration = this.#registrations.get(domain);
		if (!state || !registration || this.scope.destroyed) return;
		state.scheduled = false;
		if (state.running) {
			state.rerun = true;
			return;
		}
		state.running = true;
		try {
			do {
				state.rerun = false;
				const source = state.source;
				try {
					await registration.refresh(source);
				} catch (cause) {
					this.#onDiagnostic(Object.freeze({ domain, source, cause }));
				}
			} while (
				state.rerun &&
				!this.scope.destroyed &&
				this.#registrations.get(domain) === registration
			);
		} finally {
			state.running = false;
		}
	}
}
