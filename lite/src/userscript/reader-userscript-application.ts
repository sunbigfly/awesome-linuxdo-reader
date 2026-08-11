import {
	BrowserDiscourseHostPort,
	ReaderApplication,
	browserBodyReady,
	type BrowserDiscourseHostPortOptions,
	type ReaderApplicationPreferencesPort,
	type ReaderApplicationStage,
} from '../app/reader-application.js';
import {
	createReaderBrowserRuntimeStage,
	type ReaderBrowserConnectOptions,
	type ReaderBrowserResourceOptions,
	type ReaderBrowserCreditOptions,
	type ReaderBrowserRuntimeStageOptions,
} from '../app/reader-browser-runtime.js';
import type {
	DiscourseComposerPostInput,
	DiscourseComposerTopicInput,
} from '../discourse/native-composer.js';
import type { Cleanup } from '../kernel/lifecycle.js';
import { valueRecord as record } from '../kernel/value-record.js';
import type {
	ReaderLightboxCommentPostInput,
} from '../media/reader-lightbox-comment-model.js';
import type {
	CanonicalActionPost,
} from '../post/post-action-feature-commands.js';
import type {
	ReaderShareSurfacePort,
} from '../post/reader-share-action-coordinator.js';
import type {
	BrowserUserscriptExternalHttpPortOptions,
	ExternalTranslationHttpPort,
	TranslationRequestAdapterOptions,
} from '../translation/translation-request-adapter.js';
import type {
	PublicResourceHttpPort,
} from '../network/public-resource-request-adapter.js';
import type {
	BrowserAssetCacheStoragePort,
} from '../cache/browser-asset-cache.js';
import type {
	BrowserUserscriptEnvironment,
} from './browser-userscript-environment.js';
import {
	ReaderUserscriptTargetAdapter,
	type ReaderUserscriptInterceptedTarget,
	type ReaderUserscriptRouteChangePort,
} from './reader-userscript-target-adapter.js';
import {
	ReaderHostTopicSourceCoordinator,
} from './reader-host-topic-source-coordinator.js';
import {
	ReaderFloatingHostTargetController,
} from './reader-floating-host-target-controller.js';

export interface ReaderUserscriptApplicationOptions<TPreferences extends object> {
	readonly environment: BrowserUserscriptEnvironment;
	readonly document: Document;
	readonly window: Window;
	readonly preferences: ReaderApplicationPreferencesPort<TPreferences>;
	readonly stages: readonly ReaderApplicationStage<TPreferences>[];
	readonly isVerifiedHost?: (
		hostname: string,
		signal: AbortSignal,
	) => boolean | Promise<boolean>;
	readonly hostTimeoutMs?: number;
	readonly createHostObserver?: BrowserDiscourseHostPortOptions['createObserver'];
}

export type ReaderUserscriptTranslationOptions = Omit<
	TranslationRequestAdapterOptions,
	'gateway' | 'http'
> & {
	readonly http?: Omit<BrowserUserscriptExternalHttpPortOptions, 'request'>;
};

export type ReaderUserscriptResourceOptions = Omit<
	ReaderBrowserResourceOptions,
	'http' | 'objectUrls' | 'downloadMount'
>;

export interface ReaderUserscriptRuntimeBindings {
	readonly host: BrowserUserscriptEnvironment['discourseHost'];
	readonly share: ReaderShareSurfacePort;
	readonly translation?: Omit<TranslationRequestAdapterOptions, 'gateway'>;
	readonly connect?: ReaderBrowserConnectOptions;
	readonly credit?: ReaderBrowserCreditOptions;
	readonly resources?: ReaderBrowserResourceOptions;
	readonly assetCacheStorage?: BrowserAssetCacheStoragePort;
}

export interface ReaderUserscriptTargetStageOptions<
	TPreferences extends object,
> {
	readonly openInitialRoute?: boolean;
	readonly interceptTopicLinks?: boolean;
	readonly selectOpenTopicsAtFirstPost?: (
		preferences: Readonly<TPreferences>,
	) => boolean;
	readonly beforeOpenTarget?: (
		target: ReaderUserscriptInterceptedTarget,
	) => void | Promise<void>;
	readonly onError?: (error: unknown) => void;
}

export interface ReaderUserscriptRuntimeStageOptions<
	TPreferences extends object,
	TTopic extends DiscourseComposerTopicInput<TPost>,
	TPost extends ReaderLightboxCommentPostInput
		& DiscourseComposerPostInput
		& CanonicalActionPost,
> {
	readonly environment: BrowserUserscriptEnvironment;
	readonly shell: ReaderBrowserRuntimeStageOptions<
		TPreferences,
		TTopic,
		TPost
	>['shell'];
	readonly runtime: Omit<
		ReaderBrowserRuntimeStageOptions<TPreferences, TTopic, TPost>['runtime'],
		'host' | 'share' | 'translation' | 'resources' | 'assetCacheStorage'
	>;
	readonly translation?: ReaderUserscriptTranslationOptions;
	readonly resources?: ReaderUserscriptResourceOptions;
	readonly selectNavigationPreferences?: ReaderBrowserRuntimeStageOptions<
		TPreferences,
		TTopic,
		TPost
	>['selectNavigationPreferences'];
	readonly selectPerformancePreferences?: ReaderBrowserRuntimeStageOptions<
		TPreferences,
		TTopic,
		TPost
	>['selectPerformancePreferences'];
	readonly performanceBudgetCeilings?: ReaderBrowserRuntimeStageOptions<
		TPreferences,
		TTopic,
		TPost
	>['performanceBudgetCeilings'];
	readonly layout?: ReaderBrowserRuntimeStageOptions<
		TPreferences,
		TTopic,
		TPost
	>['layout'];
	readonly appearance?: ReaderBrowserRuntimeStageOptions<
		TPreferences,
		TTopic,
		TPost
	>['appearance'];
	readonly theme?: ReaderBrowserRuntimeStageOptions<
		TPreferences,
		TTopic,
		TPost
	>['theme'];
	readonly font?: ReaderBrowserRuntimeStageOptions<
		TPreferences,
		TTopic,
		TPost
	>['font'];
	readonly motion?: ReaderBrowserRuntimeStageOptions<
		TPreferences,
		TTopic,
		TPost
	>['motion'];
	readonly image?: ReaderBrowserRuntimeStageOptions<
		TPreferences,
		TTopic,
		TPost
	>['image'];
	readonly boostCopy?: ReaderBrowserRuntimeStageOptions<
		TPreferences,
		TTopic,
		TPost
	>['boostCopy'];
	readonly topicActionRail?: ReaderBrowserRuntimeStageOptions<
		TPreferences,
		TTopic,
		TPost
	>['topicActionRail'];
	readonly openQueue?: ReaderBrowserRuntimeStageOptions<
		TPreferences,
		TTopic,
		TPost
	>['openQueue'];
	readonly shortcuts?: ReaderBrowserRuntimeStageOptions<
		TPreferences,
		TTopic,
		TPost
	>['shortcuts'];
	readonly settings?: ReaderBrowserRuntimeStageOptions<
		TPreferences,
		TTopic,
		TPost
	>['settings'];
	readonly selectHistoryNavigationPreferences?: ReaderBrowserRuntimeStageOptions<
		TPreferences,
		TTopic,
		TPost
	>['selectHistoryNavigationPreferences'];
	readonly selectHistoryPanelPreferences?: ReaderBrowserRuntimeStageOptions<
		TPreferences,
		TTopic,
		TPost
	>['selectHistoryPanelPreferences'];
	readonly selectBookmarkPreferences?: ReaderBrowserRuntimeStageOptions<
		TPreferences,
		TTopic,
		TPost
	>['selectBookmarkPreferences'];
	readonly selectTimelineViewPreferences?: ReaderBrowserRuntimeStageOptions<
		TPreferences,
		TTopic,
		TPost
	>['selectTimelineViewPreferences'];
	readonly selectTranslationMode?: ReaderBrowserRuntimeStageOptions<
		TPreferences,
		TTopic,
		TPost
	>['selectTranslationMode'];
	readonly persistTranslationMode?: ReaderBrowserRuntimeStageOptions<
		TPreferences,
		TTopic,
		TPost
	>['persistTranslationMode'];
	readonly onReady?: ReaderBrowserRuntimeStageOptions<
		TPreferences,
		TTopic,
		TPost
	>['onReady'];
	readonly targets?: false | ReaderUserscriptTargetStageOptions<TPreferences>;
}

/**
 * Discourse 原生 page-change 的唯一 userscript 端口。
 *
 * 只复用 `discourse/lib/plugin-api#withPluginApi` 与 `api.onPageChange`；缺少模块时返回 null，
 * 由 target adapter 保留初始 URL 和链接入口，不回退到 history monkey-patch 或轮询。
 */
export function createReaderUserscriptRouteChangePort(
	host: BrowserUserscriptEnvironment['discourseHost'],
): ReaderUserscriptRouteChangePort | null {
	const module = record(host.lookupModule('discourse/lib/plugin-api'));
	const defaultExport = record(module?.default);
	const owner = typeof module?.withPluginApi === 'function'
		? module
		: defaultExport;
	const withPluginApi = owner?.withPluginApi;
	if (typeof withPluginApi !== 'function') return null;
	return Object.freeze({
		subscribe(handler: () => void): Cleanup {
			if (typeof handler !== 'function') {
				throw new TypeError('Discourse page-change handler 必须是函数');
			}
			let active = true;
			let pageCleanup: Cleanup | null = null;
			let pluginCleanup: Cleanup | null = null;
			const result = withPluginApi.call(owner, (apiValue: unknown) => {
				if (!active) return;
				const api = record(apiValue);
				const onPageChange = api?.onPageChange;
				if (typeof onPageChange !== 'function') {
					throw new Error('Discourse plugin API 缺少 onPageChange');
				}
				const cleanup = onPageChange.call(api, () => {
					if (active) handler();
				});
				if (typeof cleanup === 'function') {
					pageCleanup = cleanup as Cleanup;
				}
			});
			if (typeof result === 'function') pluginCleanup = result as Cleanup;
			return () => {
				if (!active) return;
				active = false;
				try {
					pageCleanup?.();
				} finally {
					pluginCleanup?.();
				}
			};
		},
	});
}

/**
 * userscript 启动链的唯一 application 工厂。
 *
 * 所有 HTTPS host 都先做本地 Discourse 识别；DOM marker 只用于识别，不会创建探测
 * 请求。已验证站点列表只在本地识别失败后兜底，不再作为未知域名的前置白名单。
 * 函数本身无副作用，调用者仍须显式 start/destroy。
 */
export function createReaderUserscriptApplication<TPreferences extends object>(
	options: ReaderUserscriptApplicationOptions<TPreferences>,
): ReaderApplication<TPreferences> {
	const detectedHost = new BrowserDiscourseHostPort({
		moduleLookup: (name) => options.environment.discourseHost.lookupModule(name),
		document: options.document,
		window: options.window,
		...(options.hostTimeoutMs === undefined
			? {}
			: { timeoutMs: options.hostTimeoutMs }),
		...(options.createHostObserver === undefined
			? {}
			: { createObserver: options.createHostObserver }),
	});
	const host = options.isVerifiedHost
		? Object.freeze({
			async waitForHost(signal: AbortSignal) {
				const detected = await detectedHost.waitForHost(signal);
				if (detected || signal.aborted) return detected;
				const hostname = String(
					options.document.location?.hostname ??
					options.window.location?.hostname ??
					'',
				).trim();
				const verified = await options.isVerifiedHost!(
					hostname,
					signal,
				);
				if (!verified || signal.aborted) return null;
				return Object.freeze({ detection: 'verified-site' as const });
			},
		})
		: detectedHost;
	return new ReaderApplication({
		bodyReady: (signal) => browserBodyReady(options.document, signal),
		host,
		preferences: options.preferences,
		stages: options.stages,
	});
}

export function createReaderUserscriptRuntimeBindings(
	environment: BrowserUserscriptEnvironment,
	translationOptions?: ReaderUserscriptTranslationOptions,
	resourceOptions?: ReaderUserscriptResourceOptions,
): ReaderUserscriptRuntimeBindings {
	let externalHttp: ExternalTranslationHttpPort | undefined;
	try {
		externalHttp = environment.createExternalHttp(
			translationOptions?.http,
		);
	} catch (cause) {
		if (translationOptions) throw cause;
	}
	let translation: Omit<TranslationRequestAdapterOptions, 'gateway'> | undefined;
	if (translationOptions) {
		if (!externalHttp) throw new Error('外部翻译 HTTP capability 不可用');
		const { http: _httpOptions, ...adapterOptions } = translationOptions;
		translation = Object.freeze({ ...adapterOptions, http: externalHttp });
	}
	let resources: ReaderBrowserResourceOptions | undefined;
	if (resourceOptions) {
		const http: PublicResourceHttpPort = environment.createPublicResourceHttp();
		resources = Object.freeze({
			...resourceOptions,
			http,
			objectUrls: environment.createObjectUrlPort(),
		});
	}
	const valueStorage = environment.createValueStorage();
	const assetCacheStorage = environment.createAssetCacheStorage();
	return Object.freeze({
		host: environment.discourseHost,
		share: environment.createShareSurface(),
		...(externalHttp
			? {
				connect: Object.freeze({ http: externalHttp }),
				credit: Object.freeze({
					http: externalHttp,
					...(valueStorage
						? { storage: valueStorage }
						: {}),
				}),
			}
			: {}),
		...(translation === undefined ? {} : { translation }),
		...(resources === undefined ? {} : { resources }),
		...(assetCacheStorage ? { assetCacheStorage } : {}),
	});
}

/**
 * 真实 userscript runtime stage 的唯一组合器。
 *
 * 调用者不能注入第二个 Discourse host 或任意翻译 HTTP transport：站内能力固定来自
 * environment.discourseHost，站外翻译固定来自 environment 的 GM 白名单端口。
 */
export function createReaderUserscriptRuntimeStage<
	TPreferences extends object,
	TTopic extends DiscourseComposerTopicInput<TPost>,
	TPost extends ReaderLightboxCommentPostInput
		& DiscourseComposerPostInput
		& CanonicalActionPost,
>(
	options: ReaderUserscriptRuntimeStageOptions<TPreferences, TTopic, TPost>,
): ReaderApplicationStage<TPreferences> {
	const bindings = createReaderUserscriptRuntimeBindings(
		options.environment,
		options.translation,
		options.resources,
	);
	const valueStorage = options.environment.createValueStorage();
	const onReady = options.onReady as ((
		...args: Parameters<NonNullable<typeof options.onReady>>
	) => void | Cleanup) | undefined;
	const targetOptions: ReaderUserscriptTargetStageOptions<TPreferences> | null =
		options.targets === false
		? null
		: options.targets ?? Object.freeze({});
	return createReaderBrowserRuntimeStage({
		shell: options.shell,
		runtime: {
			...options.runtime,
			searchForms:
				options.runtime.searchForms ??
				options.environment.createPinyinSearchForms(),
			host: bindings.host,
			share: bindings.share,
			...(bindings.connect ? { connect: bindings.connect } : {}),
			...(bindings.credit ? { credit: bindings.credit } : {}),
			...(bindings.translation === undefined
				? {}
				: { translation: bindings.translation }),
			...(bindings.resources === undefined
				? {}
				: { resources: bindings.resources }),
			...(bindings.assetCacheStorage === undefined
				? {}
				: { assetCacheStorage: bindings.assetCacheStorage }),
			...(options.runtime.threadContextStorage !== undefined ||
					!valueStorage
				? {}
				: { threadContextStorage: valueStorage }),
		},
		...(options.selectNavigationPreferences === undefined
			? {}
			: {
				selectNavigationPreferences:
					options.selectNavigationPreferences,
			}),
		...(options.selectPerformancePreferences === undefined
			? {}
			: {
				selectPerformancePreferences:
					options.selectPerformancePreferences,
			}),
		...(options.performanceBudgetCeilings === undefined
			? {}
			: {
				performanceBudgetCeilings:
					options.performanceBudgetCeilings,
			}),
		...(options.layout === undefined
			? {}
			: { layout: options.layout }),
		...(options.appearance === undefined
			? {}
			: { appearance: options.appearance }),
		...(options.theme === undefined
			? {}
			: { theme: options.theme }),
		...(options.font === undefined
			? {}
			: { font: options.font }),
		...(options.motion === undefined
			? {}
			: { motion: options.motion }),
		...(options.image === undefined
			? {}
			: { image: options.image }),
		...(options.boostCopy === undefined
			? {}
			: { boostCopy: options.boostCopy }),
		...(options.topicActionRail === undefined
			? {}
			: { topicActionRail: options.topicActionRail }),
		...(options.openQueue === undefined
			? {}
			: { openQueue: options.openQueue }),
		...(options.shortcuts === undefined
			? {}
			: { shortcuts: options.shortcuts }),
		...(options.settings === undefined
			? {}
			: { settings: options.settings }),
		...(options.selectHistoryNavigationPreferences === undefined
			? {}
			: {
				selectHistoryNavigationPreferences:
					options.selectHistoryNavigationPreferences,
			}),
		...(options.selectHistoryPanelPreferences === undefined
			? {}
			: {
				selectHistoryPanelPreferences:
					options.selectHistoryPanelPreferences,
			}),
		...(options.selectBookmarkPreferences === undefined
			? {}
			: {
				selectBookmarkPreferences:
					options.selectBookmarkPreferences,
			}),
		...(options.selectTimelineViewPreferences === undefined
			? {}
			: {
				selectTimelineViewPreferences:
					options.selectTimelineViewPreferences,
			}),
		...(options.selectTranslationMode === undefined
			? {}
			: {
				selectTranslationMode:
					options.selectTranslationMode,
			}),
		...(options.persistTranslationMode === undefined
			? {}
			: {
				persistTranslationMode:
					options.persistTranslationMode,
			}),
		onReady(
			runtime,
			context,
			settings,
			settingsView,
			layout,
			appearance,
			font,
		) {
			let targetAdapter: ReaderUserscriptTargetAdapter | null = null;
			let floatingHostTarget:
				| ReaderFloatingHostTargetController
				| null = null;
			let hostSource:
				| ReaderHostTopicSourceCoordinator
				| null = null;
			let readyCleanup: Cleanup | undefined;
			try {
				if (targetOptions) {
					floatingHostTarget = new ReaderFloatingHostTargetController({
						document: options.runtime.document,
						overlay: runtime.shell.view.root,
						workspace: runtime.workspace.workspace,
						window: runtime.workspace.window,
						currentUrl: () =>
							options.runtime.document.location.href,
						target: {
							openTarget: (request) =>
								runtime.openTarget(request),
						},
						closeReader: () => runtime.close(),
						readOpenTopicsAtFirstPost: () =>
							targetOptions.selectOpenTopicsAtFirstPost?.(
								context.readPreferences(),
							) === true,
						parentScope: runtime.scope,
						...(targetOptions.onError === undefined
							? {}
							: { onError: targetOptions.onError }),
					});
					hostSource = new ReaderHostTopicSourceCoordinator({
						document: options.runtime.document,
						host: options.environment.discourseHost,
						readerRoot: runtime.shell.view.root,
						isEmbedded: () =>
							runtime.workspace.workspace.snapshot.presentation.embedded,
						parentScope: runtime.scope,
					});
					targetAdapter = new ReaderUserscriptTargetAdapter({
						document: options.runtime.document,
						currentUrl: () =>
							options.runtime.document.location.href,
						target: {
							openTarget: (request) =>
								runtime.openTarget(request),
						},
						routeChanges: createReaderUserscriptRouteChangePort(
							options.environment.discourseHost,
						),
						serviceWorkerMessages:
							options.runtime.document.defaultView?.navigator
								.serviceWorker ?? null,
						interceptServiceWorkerTopicTargets: () =>
							runtime.workspace.workspace.snapshot.presentation.embedded,
						readOpenTopicsAtFirstPost: () =>
							targetOptions.selectOpenTopicsAtFirstPost?.(
								context.readPreferences(),
							) === true,
						...(targetOptions.openInitialRoute === undefined
							? {}
							: {
								openInitialRoute:
									targetOptions.openInitialRoute,
							}),
						...(targetOptions.interceptTopicLinks === undefined
							? {}
							: {
								interceptTopicLinks:
									targetOptions.interceptTopicLinks,
							}),
						beforeOpenTarget: async (target) => {
							await hostSource!.prepare(target);
							await targetOptions.beforeOpenTarget?.(target);
						},
						afterOpenTarget: async (target, opened) => {
							await hostSource!.settle(target, opened);
						},
						parentScope: runtime.scope,
						...(targetOptions.onError === undefined
							? {}
							: { onError: targetOptions.onError }),
					});
				}
				readyCleanup =
					onReady?.(
						runtime,
						context,
						settings,
						settingsView,
						layout,
						appearance,
						font,
					) ||
					undefined;
			} catch (error) {
				targetAdapter?.destroy();
				floatingHostTarget?.destroy();
				hostSource?.destroy();
				throw error;
			}
			return () => {
				try {
					readyCleanup?.();
				} finally {
					targetAdapter?.destroy();
					floatingHostTarget?.destroy();
					hostSource?.destroy();
				}
			};
		},
	});
}
