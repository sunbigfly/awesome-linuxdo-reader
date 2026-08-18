import type {
	ReaderBrowserRuntime,
} from '../app/reader-browser-runtime.js';
import {
	discourseNativeBoostsAvailable,
	discourseNativeInitialCurrentUsername,
	discourseNativeIconRenderer,
	discourseNativeSiteLogoUrl,
	discourseNativeDefaultSiteTheme,
	discourseNativeTheme,
} from '../discourse/native-host-api.js';
import type {
	DiscourseComposerPostInput,
	DiscourseComposerTopicInput,
} from '../discourse/native-composer.js';
import {
	ReaderNativeComposerWindowController,
} from '../discourse/reader-native-composer-window.js';
import { resolveReaderIcon } from '../components/reader-icon.js';
import type {
	ReaderLightboxCommentPostInput,
} from '../media/reader-lightbox-comment-model.js';
import {
	normalizeReaderHistoryAnchorState,
} from '../history/reader-history-model.js';
import {
	readerKatexStylesheet,
} from '../media/reader-katex-controller.js';
import {
	readerPreferencesImageAdapter,
} from '../media/reader-image-preferences.js';
import type {
	CanonicalActionPost,
} from '../post/post-action-feature-commands.js';
import {
	readerPreferencesAppearanceAdapter,
} from '../appearance/reader-appearance-style-controller.js';
import {
	readerPreferencesThemeAdapter,
} from '../appearance/reader-theme-controller.js';
import {
	createReaderBrowserThemeClock,
} from '../appearance/reader-local-sun-clock.js';
import {
	readerPreferencesFontAdapter,
} from '../font/reader-font-style-controller.js';
import {
	readerPreferencesLayoutAdapter,
} from '../layout/reader-layout-style-controller.js';
import type {
	ReaderApplication,
	ReaderApplicationContext,
	ReaderApplicationDiagnostic,
	ReaderApplicationStage,
	ReaderApplicationState,
} from '../app/reader-application.js';
import type {
	LifecycleScope,
} from '../kernel/lifecycle.js';
import {
	createReaderShellTemplate,
	type ReaderShellTemplate,
} from '../shell/reader-shell-template.js';
import {
	dismissReaderFloatingWindowTabSessionFromEscape,
} from '../shell/reader-floating-window-frame.js';
import { ReaderSurfacePortal } from '../shell/reader-surface-portal.js';
import {
	readerPreferencesShortcutAdapter,
} from '../shell/reader-shortcut-controller.js';
import {
	readerWorkspacePositionMode,
	type ReaderWorkspaceMode,
} from '../shell/reader-workspace.js';
import {
	EmbeddedHostTopicCardEnhancement,
} from '../shell/embedded-host-topic-card-enhancement.js';
import {
	readerPreferencesMotionAdapter,
} from '../settings/reader-motion-settings-form.js';
import {
	readerPreferencesBoostCopyAdapter,
} from '../post/boost-copy-rule.js';
import {
	readerPreferencesTopicActionRailAdapter,
} from '../post/reader-topic-action-rail.js';
import {
	readerPreferencesUnwantedTopicFilterAdapter,
	readerUnwantedTopicFilterPreferencesEqual,
	readerUnwantedTopicFilterMatch,
	type ReaderUnwantedTopicFilterPreferences,
	type ReaderUnwantedTopicFilterPreferencesPort,
} from '../collection/reader-unwanted-topic-filter.js';
import {
	readerPreferencesPerformanceSettingsAdapter,
} from '../settings/reader-performance-settings-form.js';
import {
	readerPreferencesReadingSettingsAdapter,
} from '../settings/reader-reading-settings-form.js';
import {
	requestReaderQueueSurfacePositionsReset,
} from '../queue/reader-open-queue-session.js';
import {
	showReaderSettingsResetReminder,
} from '../settings/reader-settings-reset-reminder.js';
import {
	ReaderBrowserStorageManagementSurface,
} from '../settings/reader-browser-storage-management.js';
import {
	ReaderPostReadViewportFeature,
} from '../reading/read-viewport-adapter.js';
import {
	READER_PREFERENCES_STORAGE_KEY,
	createReaderPreferencesConfigCodec,
	createReaderPreferencesDefaults,
	createReaderPreferencesResetValue,
	createReaderPreferencesRepository,
	type ReaderPreferences,
} from '../state/reader-preferences-schema.js';
import {
	ReaderInformationFlowCoordinator,
	type ReaderInformationFlowDomain,
} from '../state/reader-information-flow-coordinator.js';
import {
	createReaderPostPresentation,
	createReaderPostReadStateFeature,
	type ReaderPostPresentationPost,
} from '../topic/reader-post-presentation.js';
import {
	translationTextFingerprint,
} from '../translation/translation-text.js';
import {
	ReaderTranslationConfigRepository,
} from '../translation/reader-translation-config.js';
import {
	ReaderReplyTreePreferencesPreview,
	readerPreferencesReplyTreeAdapter,
} from '../topic/reader-reply-tree-preferences.js';
import {
	BrowserUserscriptEnvironment,
	type BrowserUserscriptValueStoragePort,
} from './browser-userscript-environment.js';
import {
	createReaderUserscriptApplication,
	createReaderUserscriptRuntimeStage,
} from './reader-userscript-application.js';
import {
	createReaderUserscriptServiceWorkerMessageRelay,
	readerUserscriptRouteKind,
	type ReaderUserscriptServiceWorkerMessageRelay,
} from './reader-userscript-target-adapter.js';
import {
	consumeReaderNativeBypass,
	consumeReaderNativeTabBypass,
} from '../topic/reader-native-topic-route.js';
import {
	scheduleReaderCreditAccountBridge,
} from '../user/reader-credit-account-bridge.js';
import type {
	ReaderDiscourseSiteProbeTransportPort,
} from '../site/browser-discourse-site-probe.js';
import {
	ReaderCustomSiteRepository,
	readerBuiltinDiscourseHost,
	readerDiscourseSiteAllowsBodyTranslation,
	readerDiscourseSiteDisplayName,
} from '../site/reader-custom-site-repository.js';
import {
	ReaderEmbeddedReloadCoordinator,
} from './reader-embedded-reload-coordinator.js';
import {
	isReaderCloudflareChallengeWindow,
	monitorReaderCloudflareChallengeWindow,
	READER_BACKGROUND_REQUEST_IDLE_INTERVAL_MS,
	READER_BACKGROUND_REQUEST_MAX_DEFER_MS,
} from '../network/browser-shared-request-permit.js';
import {
	ReaderWebDavConfigRepository,
} from '../sync/reader-webdav-config-repository.js';
import type { ReaderWebDavClient } from '../sync/reader-webdav-client.js';

const DEBUG_HANDLE_KEY = '__LDP_MAIN_LITE__';
const LEGACY_DEBUG_HANDLE_KEY = '__LDP_MIAN_LITE__';
const CHALLENGE_MONITOR_KEY = '__LDP_CLOUDFLARE_CHALLENGE_MONITOR__';
// Stable 1.0.0 DOM/storage identities keep upgrades free of duplicate UI and state loss.
const STYLE_ID = 'ldp-mian-lite-styles';
const STYLE_RESOURCE = 'ldpReaderStyles';
const KATEX_STYLE_RESOURCE = 'ldpKatexStyles';
const KATEX_STYLESHEET_URL =
	'https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css';

type MainLitePost = ReaderPostPresentationPost
	& DiscourseComposerPostInput
	& ReaderLightboxCommentPostInput
	& CanonicalActionPost
	& Readonly<Record<string, unknown>>;

interface MainLiteTopic extends DiscourseComposerTopicInput<MainLitePost> {
	readonly [key: string]: unknown;
}

export interface MainLiteUserscriptHandle {
	readonly application: ReaderApplication<ReaderPreferences>;
	readonly started: Promise<ReaderApplicationState>;
	readonly diagnostics: readonly ReaderApplicationDiagnostic[];
	readonly runtime: ReaderBrowserRuntime<MainLiteTopic, MainLitePost> | null;
	destroy(): void;
}

interface MutableMainLiteState {
	runtime: ReaderBrowserRuntime<MainLiteTopic, MainLitePost> | null;
	portal: ReaderSurfacePortal | null;
	informationFlow: ReaderInformationFlowCoordinator | null;
	readonly diagnostics: ReaderApplicationDiagnostic[];
}

function pageRecord(value: unknown): Record<string, unknown> {
	if (value === null || (
		typeof value !== 'object' &&
		typeof value !== 'function'
	)) {
		throw new Error('main-lite page window 不可用');
	}
	return value as Record<string, unknown>;
}

function theme(document: Document, window: Window): 'light' | 'dark' {
	if (
		document.documentElement.classList.contains('dark') ||
		document.documentElement.dataset.colorScheme === 'dark'
	) return 'dark';
	return window.matchMedia?.('(prefers-color-scheme: dark)').matches
		? 'dark'
		: 'light';
}

function sourceId(window: Window): string {
	const value = window.crypto?.randomUUID?.();
	return value
		? `main-lite:${value}`
		: `main-lite:${Date.now()}`;
}

function unavailableLocalStorage(cause: unknown): Storage {
	const error = cause instanceof Error
		? cause
		: new DOMException('当前页面无法访问 localStorage', 'SecurityError');
	return Object.freeze({
		length: 0,
		clear(): void {
			throw error;
		},
		getItem(): string | null {
			// 允许 Reader 以默认设置建立错误提示 surface；所有写入仍保持硬失败。
			return null;
		},
		key(): string | null {
			return null;
		},
		removeItem(): void {
			throw error;
		},
		setItem(): void {
			throw error;
		},
	});
}

function createStyleStage(
	environment: BrowserUserscriptEnvironment,
	document: Document,
	state: MutableMainLiteState,
): ReaderApplicationStage<ReaderPreferences> {
	return Object.freeze({
		name: 'userscript-styles',
		required: true,
		async setup() {
			const [css, katexCss] = await Promise.all([
				environment.readTextResource(STYLE_RESOURCE),
				environment.readTextResource(KATEX_STYLE_RESOURCE),
			]);
			document.getElementById(STYLE_ID)?.remove();
			const style = document.createElement('style');
			style.id = STYLE_ID;
			const stylesheet =
				`${css}\n${readerKatexStylesheet(
					katexCss,
					KATEX_STYLESHEET_URL,
				)}`;
			style.textContent = stylesheet;
			let portal: ReaderSurfacePortal | null = null;
			try {
				portal = new ReaderSurfacePortal(document, stylesheet);
				(document.head ?? document.documentElement).append(style);
			} catch (cause) {
				portal?.destroy();
				style.remove();
				throw cause;
			}
			state.portal = portal;
			return () => {
				portal.destroy();
				if (state.portal === portal) state.portal = null;
				style.remove();
			};
		},
	});
}

function createInformationFlowStage(
	window: Window,
	storage: BrowserUserscriptValueStoragePort | null,
	preferences: Readonly<{ reloadExternal(): unknown }>,
	state: MutableMainLiteState,
	bindings: readonly Readonly<{
		readonly domain: ReaderInformationFlowDomain;
		readonly keys: readonly string[];
		readonly refresh: () => void | Promise<unknown>;
	}>[],
): ReaderApplicationStage<ReaderPreferences> {
	return Object.freeze({
		name: 'information-flow',
		required: true,
		setup(scope: LifecycleScope) {
			const informationFlow = new ReaderInformationFlowCoordinator({
				storageEvents: window,
				parentScope: scope,
				onDiagnostic: ({ domain, source, cause }) => {
					console.error(
						`[main-lite:information-flow:${domain}:${source}]`,
						cause,
					);
				},
			});
			state.informationFlow = informationFlow;
			informationFlow.register({
				domain: 'preferences',
				storageKeys: [READER_PREFERENCES_STORAGE_KEY],
				refresh: () => preferences.reloadExternal(),
			});
			for (const binding of bindings) {
				if (!storage?.subscribe) continue;
				informationFlow.register({
					domain: binding.domain,
					subscriptions: binding.keys.map((key) => ({
						source: 'userscript-value',
						subscribe: (notify) => storage.subscribe!(key, notify),
					})),
					refresh: binding.refresh,
				});
			}
			return () => {
				if (state.informationFlow === informationFlow) {
					state.informationFlow = null;
				}
			};
		},
	});
}

function requestedMode(
	preferences: Readonly<ReaderPreferences>,
	routeKind: 'list' | 'direct-topic',
): ReaderWorkspaceMode {
	return routeKind === 'direct-topic'
		? preferences.topicReaderMode
		: preferences.listReaderMode;
}

function createRuntimeStage(
	environment: BrowserUserscriptEnvironment,
	document: Document,
	window: Window,
	localStorage: Storage,
	localStorageAccessError: unknown,
	state: MutableMainLiteState,
	serviceWorkerMessages: ReaderUserscriptServiceWorkerMessageRelay | null,
	suppressInitialTopicOpen: boolean,
	customSites: Readonly<{
		readonly repository: ReaderCustomSiteRepository;
		readonly probe: ReaderDiscourseSiteProbeTransportPort | null;
		readonly translation: ReaderTranslationConfigRepository | null;
		readonly webDav: Readonly<{
			readonly client: ReaderWebDavClient;
			readonly repository: ReaderWebDavConfigRepository;
		}> | null;
	}>,
): ReaderApplicationStage<ReaderPreferences> {
	let template: ReaderShellTemplate | null = null;
	const origin = document.location.origin;
	const siteName = readerDiscourseSiteDisplayName(document.location.hostname);
	const routeKind = readerUserscriptRouteKind(
		document.location.href,
		origin,
	);
	return Object.freeze({
		name: 'reader-userscript-runtime',
		required: true,
		async setup(
			scope: LifecycleScope,
			applicationContext:
				ReaderApplicationContext<ReaderPreferences>,
		) {
			const readiness = scope.abortController(
				new DOMException('main-lite runtime 启动已取消', 'AbortError'),
			);
			await environment.waitForDiscourseRuntime(readiness.signal);
			const initialPreferences = applicationContext.readPreferences();
			let defaultSiteThemeReloadRequested = false;
			const enforceEmbeddedDefaultSiteTheme = (
				mode: ReaderWorkspaceMode,
			): void => {
				if (
					routeKind !== 'list' ||
					readerWorkspacePositionMode(mode) !== 'embedded' ||
					defaultSiteThemeReloadRequested
				) return;
				const result = discourseNativeDefaultSiteTheme(
					environment.discourseHost,
				);
				if (result !== 'updated') return;
				defaultSiteThemeReloadRequested = true;
				try {
					window.location.reload();
				} catch (cause) {
					console.error('[main-lite:default-site-theme]', cause);
				}
			};
			enforceEmbeddedDefaultSiteTheme(
				requestedMode(initialPreferences, routeKind),
			);
			const replyTreePreferences =
				new ReaderReplyTreePreferencesPreview(
					readerPreferencesReplyTreeAdapter.read(initialPreferences),
					(error) => {
						console.error('[main-lite:reply-tree-preview]', error);
					},
				);
			scope.add(() => replyTreePreferences.destroy());
			const preferencesEnvironment = Object.freeze({
				viewportWidth: window.innerWidth,
				viewportHeight: window.innerHeight,
			});
			const scriptVersion =
				environment.readScriptVersion() ?? 'development';
			const preferencesCodec = createReaderPreferencesConfigCodec({
				environment: preferencesEnvironment,
				scriptVersion,
			});
			const preferencesDefaults = createReaderPreferencesDefaults(
				preferencesEnvironment,
			);
			const currentUsername = discourseNativeInitialCurrentUsername(
				environment.discourseHost,
			);
			const renderNativeIcon = discourseNativeIconRenderer(
				environment.discourseHost,
			);
			const siteLogoCandidates = [
				document.querySelector<HTMLImageElement>(
					'.d-header #site-logo,.d-header img.logo-big,' +
					'.d-header img.logo-small,.custom-logo-link img',
				)?.currentSrc,
				document.querySelector<HTMLLinkElement>(
					'link[rel~="apple-touch-icon"]',
				)?.href,
				document.querySelector<HTMLLinkElement>(
					'link[rel~="icon"]',
				)?.href,
			].filter((value): value is string => Boolean(value));
			const siteLogoUrl = discourseNativeSiteLogoUrl(
				environment.discourseHost,
				origin,
				siteLogoCandidates,
			);
			const renderIcon = (name: string, iconDocument: Document): Node => {
				const nativeIcon = renderNativeIcon(name, iconDocument);
				return resolveReaderIcon(iconDocument, name, nativeIcon);
			};
			const katex = environment.createKatexPort();
			const hls = environment.createHlsPort();
			const bodyTranslationAllowed =
				readerDiscourseSiteAllowsBodyTranslation(
					document.location.hostname,
				);
			let persistTranslationMode: ((
				mode: ReaderPreferences['translationMode'],
			) => void) | null = null;
			let hostTopicEnhancement: EmbeddedHostTopicCardEnhancement | null = null;
			let hostOpenedTopicsRegistered = false;
			const unwantedTopicFilter: ReaderUnwantedTopicFilterPreferencesPort =
				Object.freeze({
					read: () => readerPreferencesUnwantedTopicFilterAdapter.read(
						applicationContext.readPreferences(),
					),
					update: (preferences: ReaderUnwantedTopicFilterPreferences) => {
						if (!applicationContext.updatePreferences) {
							throw new Error('当前环境不能保存自动过滤设置');
						}
						applicationContext.updatePreferences(
							readerPreferencesUnwantedTopicFilterAdapter.createPatch(
								preferences,
							),
						);
					},
					subscribe: (
						listener: (
							preferences: ReaderUnwantedTopicFilterPreferences,
						) => void,
						preferenceScope?: LifecycleScope,
					) => {
						let previous = readerPreferencesUnwantedTopicFilterAdapter.read(
							applicationContext.readPreferences(),
						);
						return applicationContext.preferenceChanges.subscribe(
							(preferences) => {
								const next = readerPreferencesUnwantedTopicFilterAdapter.read(
									preferences,
								);
								if (readerUnwantedTopicFilterPreferencesEqual(
									previous,
									next,
								)) return;
								previous = next;
								listener(next);
							},
							preferenceScope,
						);
					},
				});
			const informationFlow = state.informationFlow;
			if (!informationFlow) {
				throw new Error('main-lite 统一信息流协调器尚未就绪');
			}
			const stage = createReaderUserscriptRuntimeStage<
				ReaderPreferences,
				MainLiteTopic,
				MainLitePost
			>({
		environment,
		informationFlow,
		shell: {
			compatibilityKey: () => `${origin}:mian-lite:v1`,
			createView: () => {
				const portal = state.portal;
				if (!portal) throw new Error('main-lite Shadow Portal 未就绪');
				template = createReaderShellTemplate({
					document,
					mount: portal.root,
					listModeAllowed: routeKind === 'list',
					siteName,
					homeUrl: `${origin}/`,
					logoUrl: siteLogoUrl,
					renderIcon,
				});
				return template.view;
			},
			createWorkspaceOptions: (_shell, context) => {
				if (!template) throw new Error('main-lite Shell template 未创建');
				const readPreferences = context.readPreferences;
				const scrolling = () =>
					document.scrollingElement ?? document.documentElement;
				hostTopicEnhancement = new EmbeddedHostTopicCardEnhancement(
					document,
					environment.discourseHost,
					{
						openedTopicStorage: localStorage,
						openedTopicStorageScope: currentUsername,
						isTopicHidden: (topicId) =>
							state.runtime?.unwantedTopics.isManuallyHidden(topicId) === true,
						hideTopic: (input) => {
							const runtime = state.runtime;
							if (!runtime) throw new Error('不想看仓库尚未就绪');
							runtime.unwantedTopics.remember(input);
						},
						automaticFilter: (input) => state.runtime
							? readerUnwantedTopicFilterMatch(
								readerPreferencesUnwantedTopicFilterAdapter.read(
									applicationContext.readPreferences(),
								),
								input,
							)
							: null,
						notify: (message) =>
							state.runtime?.feedback.show(message),
						onError: (cause) => {
							console.error(
								'[main-lite:host-topic-notification]',
								cause,
							);
						},
					},
				);
				if (!hostOpenedTopicsRegistered) {
					hostOpenedTopicsRegistered = true;
					scope.add(informationFlow.register({
						domain: 'host-opened-topics',
						storageKeys: [
							hostTopicEnhancement.openedTopicStorageKey,
						],
						refresh: () => hostTopicEnhancement
							?.reloadExternalOpenedTopics(),
					}));
				}
				return {
					document,
					routeKind,
					requestedMode: requestedMode(
						readPreferences(),
						routeKind,
					),
					embedWidth: readPreferences().listReaderEmbedWidth,
					windowPreferences: readPreferences(),
					topicFilterChanges: unwantedTopicFilter,
					elements: template.workspaceElements,
					viewportTarget: window,
					pointerTarget: document,
					scrollTarget: window,
					readViewport: () => ({
						width: window.innerWidth,
						height: window.innerHeight,
					}),
					hostScroll: {
						read: () => ({
							viewportHeight: window.innerHeight,
							scrollHeight: scrolling().scrollHeight,
							scrollTop: scrolling().scrollTop,
						}),
						readScrollTop: () => scrolling().scrollTop,
						scrollTo: (top) => window.scrollTo({
							top,
							behavior: 'auto',
						}),
					},
					enhancements: hostTopicEnhancement,
					readAppearance: () => {
						const preferences = readPreferences();
						const activeTheme = theme(document, window);
						return {
							profile: preferences.appearanceProfile,
							theme: activeTheme,
							defaultDividerLineColor:
								activeTheme === 'dark'
									? '#343b44'
									: '#e5e5e5',
							defaultDividerLineWidth: 0.5,
						};
					},
					onPersistMode: (mode) => {
						context.updatePreferences?.(
							routeKind === 'direct-topic'
								? {
									topicReaderMode:
										mode === 'fullpage'
											? 'fullpage'
											: 'floating',
								}
								: { listReaderMode: mode },
						);
						enforceEmbeddedDefaultSiteTheme(mode);
					},
					onPersistEmbedWidth: (listReaderEmbedWidth) => {
						context.updatePreferences?.({ listReaderEmbedWidth });
					},
					onPersistWindow: (preferences) => {
						context.updatePreferences?.({
							readerWindowWidth: preferences.readerWindowWidth,
							readerWindowHeight: preferences.readerWindowHeight,
							readerWindowX: preferences.readerWindowX,
							readerWindowY: preferences.readerWindowY,
							readerWindowLocked: preferences.readerWindowLocked,
							readerWindowPinned: preferences.readerWindowPinned,
						});
					},
					createMutationObserver: (callback) =>
						new MutationObserver(callback),
					...(typeof ResizeObserver === 'function'
						? {
							createResizeObserver: (
								callback: ResizeObserverCallback,
							) => new ResizeObserver(callback),
						}
						: {}),
					requestFrame: (callback) =>
						window.requestAnimationFrame(callback),
					cancelFrame: (id) => window.cancelAnimationFrame(id),
				};
			},
		},
		runtime: {
			document,
			renderIcon,
			translationView: bodyTranslationAllowed
				? {
					initialTheme: initialPreferences.translationTheme,
					subscribeTheme: (listener, themeScope) => {
						applicationContext.preferenceChanges.subscribe(
							(preferences) => listener(preferences.translationTheme),
							themeScope,
						);
					},
					...(customSites.translation
						? {
							initialAnimation:
								customSites.translation.snapshot.config.animation,
							subscribeAnimation: (listener, animationScope) => {
								customSites.translation!.changes.subscribe(
									(snapshot) => listener(snapshot.config.animation),
									animationScope,
								);
							},
						}
						: {}),
				}
				: false,
			storage: localStorage,
			sourceId: sourceId(window),
			locks: window.navigator.locks ?? null,
			indexedDb: window.indexedDB ?? null,
			storageEvents: window,
			broadcastChannelFactory:
				typeof BroadcastChannel === 'function'
					? (name) => new BroadcastChannel(name)
					: null,
			permit: {
				shortWindowMs: 10_000,
				longWindowMs: 60_000,
				shortBudget: 50,
				longBudget: 200,
				minIntervalMs:
					initialPreferences.performanceRequestInterval,
				maxConcurrent:
					initialPreferences.performanceRequestConcurrency,
				backgroundIdleIntervalMs:
					READER_BACKGROUND_REQUEST_IDLE_INTERVAL_MS,
				backgroundMaxDeferMs:
					READER_BACKGROUND_REQUEST_MAX_DEFER_MS,
			},
			data: {
				scheduler: {
					maxConcurrent:
						initialPreferences.performanceRequestConcurrency,
					queueLimit: 160,
					defaultTimeoutMs: 15_000,
				},
				rateLimit: {
					evidenceWindowMs: 4_000,
					maxEndpointEntries: 128,
					retryAfterFallbackMs: 1_500,
					baseUrl: origin,
				},
				responseMemoryMaxEntries: 96,
				responseMemoryMaxBytes: 24 * 1024 * 1024,
				responsePersistentMaxEntries: 600,
				responsePersistentMaxBytes: 96 * 1024 * 1024,
				responseOperationTimeoutMs: 5_000,
				cacheFlightTtlMs: 30_000,
				cacheFlightStaleMs: 45_000,
			},
				topic: {
					authScope: currentUsername
						? `account:${currentUsername}`
						: `anonymous:${origin}`,
				origin,
					pageSize: initialPreferences.performancePageSize,
					caches: {
						topic: {
							freshForMs: 30 * 60_000,
							retainForMs: 7 * 24 * 60 * 60_000,
							persist: true,
						},
						posts: {
							freshForMs: 30 * 60_000,
							retainForMs: 7 * 24 * 60 * 60_000,
							persist: true,
						},
						nested: {
							freshForMs: 30 * 60_000,
							retainForMs: 7 * 24 * 60 * 60_000,
							persist: true,
						},
						snapshot: {
							freshForMs: 30 * 60_000,
							retainForMs: 30 * 24 * 60 * 60_000,
						},
					},
				},
				timelineView: {
					preferences: {
						pageStep: initialPreferences.performancePageSize,
					},
				},
				history: {
					panelView: {
						preferences: {
							sortMode: initialPreferences.historySortMode,
						},
						topicHref: (entry) => `${origin}/t/${entry.topicId}`,
						changeSortMode: (historySortMode) => {
							applicationContext.updatePreferences?.({
								historySortMode,
							});
						},
					},
				},
				media: {
					...(katex ? { katex } : {}),
				...(hls ? { hls } : {}),
				hasManagedMediaSource:
					'ManagedMediaSource' in window,
			},
			lightbox: {
				mount: () => template?.view.surfaceHost ?? document.body,
			},
			topicFactory: {
				createDomOptions: (bundle, context, _root, services) => {
					const presentation =
						createReaderPostPresentation<MainLitePost>({
							document,
							presentation: services.presentation,
							relativeTime: services.relativeTime,
							exactTime: services.exactTime,
							readTopic: () => bundle.services.session.topic,
							currentUsername: services.currentUsername,
							recoverAvatarSource: services.recoverAvatarSource,
							renderIcon,
						});
					const readState = createReaderPostReadStateFeature<MainLitePost>({
						readState: bundle.services.read,
						parentScope: context.scope,
						renderIcon,
						prefersReducedMotion: () => Boolean(window.matchMedia?.(
							'(prefers-reduced-motion: reduce)',
						).matches),
						isVisible: (view) => {
							const postRoot = view.slots.root;
							if (!postRoot.isConnected || !postRoot.getClientRects().length) {
								return false;
							}
							const rect = postRoot.getBoundingClientRect();
							const descendantRoot = postRoot.closest<HTMLElement>(
								'.ldp-descendant-replies-list',
							);
							const scrollRoot = descendantRoot ?? template?.view.body;
							const viewport = scrollRoot?.getBoundingClientRect() ?? {
								top: 0,
								right: window.innerWidth,
								bottom: window.innerHeight,
								left: 0,
							};
							return rect.bottom > viewport.top &&
								rect.top < viewport.bottom &&
								rect.right > viewport.left &&
								rect.left < viewport.right;
						},
					});
					const readViewport =
						new ReaderPostReadViewportFeature<MainLitePost>({
							controller: bundle.services.read,
							document,
							parentScope: context.scope,
							rootFor: (postRoot) => {
								const discussion = postRoot.closest<HTMLElement>(
									'.ldp-descendant-replies-list',
								);
								if (discussion) return discussion;
								if (postRoot.closest(
									'.ldp-lb-comment-list,.ldp-topic-action-rail',
								)) return false;
								return template?.view.body ?? null;
							},
						});
						return {
							estimatedRootSize: 360,
							identity: presentation.identity,
							render: presentation.render,
							postFeatures: Object.freeze([readViewport, readState]),
							replyTreePreferences: {
								read: () => replyTreePreferences.read(),
								subscribe: (listener, preferenceScope) =>
									replyTreePreferences.subscribe(
										listener,
										preferenceScope,
									),
							},
						};
				},
				},
				unwantedTopicFilter,
				onTopicFeatureError: (diagnostic) => {
				console.error(
					`[main-lite:${diagnostic.feature}]`,
					diagnostic.cause,
				);
			},
		},
		translation: {
			...(customSites.translation
				? {
					readConfig: async () =>
						(await customSites.translation!.load()).config,
				}
				: {}),
			fingerprint: (texts) => {
				const subtle = window.crypto?.subtle;
				if (!subtle) {
					return Promise.reject(new Error('浏览器缺少 SubtleCrypto'));
				}
				return translationTextFingerprint(texts, subtle);
			},
			translationCache: {
				kind: 'translations',
				tags: ['translation:zh-CN'],
				freshForMs: 30 * 24 * 60 * 60_000,
				retainForMs: 180 * 24 * 60 * 60_000,
				persist: true,
			},
			credentialCache: {
				kind: 'translation-credentials',
				tags: ['translation:credential'],
				freshForMs: 8 * 60_000,
				retainForMs: 8 * 60_000,
				persist: false,
			},
		},
		resources: {
			baseUrl: origin,
			cache: {
				kind: 'images',
				tags: ['images'],
				freshForMs: 24 * 60 * 60_000,
				retainForMs: 30 * 24 * 60 * 60_000,
				persist: true,
			},
		},
		selectPerformancePreferences: (preferences) => preferences,
		performanceBudgetCeilings: { short: 50, long: 200 },
		layout: readerPreferencesLayoutAdapter,
		appearance: readerPreferencesAppearanceAdapter,
		theme: {
			preferences: readerPreferencesThemeAdapter,
			hostTheme: discourseNativeTheme(environment.discourseHost),
			clock: createReaderBrowserThemeClock({ window, document }),
			system: {
				readDark: () =>
					Boolean(window.matchMedia?.(
						'(prefers-color-scheme: dark)',
					).matches),
				subscribe: (listener, scope) => {
					const query = window.matchMedia?.(
						'(prefers-color-scheme: dark)',
					);
					if (!query) return () => {};
					const onChange = () => listener(query.matches);
					query.addEventListener('change', onChange);
					const cleanup = () =>
						query.removeEventListener('change', onChange);
					scope.add(cleanup);
					return cleanup;
				},
				},
		},
		font: readerPreferencesFontAdapter,
		motion: {
			...readerPreferencesMotionAdapter,
			siteName,
		},
		image: readerPreferencesImageAdapter,
		boostCopy: readerPreferencesBoostCopyAdapter,
		topicActionRail: readerPreferencesTopicActionRailAdapter,
		openQueue: {
			read: (preferences) => Object.freeze({
				openTopicsAtFirstPost:
					preferences.openTopicsAtFirstPost,
				readerQueueAlwaysVisibleWhenEmpty:
						preferences.readerQueueAlwaysVisibleWhenEmpty,
					doubleEscapeToCloseReader:
						preferences.doubleEscapeToCloseReader,
					confirmNativeComposerClose:
						preferences.confirmNativeComposerClose,
				}),
			createPatch: (preferences) => preferences,
		},
		shortcuts: readerPreferencesShortcutAdapter,
		settings: {
			view: { brandName: 'Awesome LinuxDo Reader' },
			sitesForm: customSites,
			...(customSites.webDav
				? {
					webDav: {
						...customSites.webDav,
						customSites: customSites.repository,
						preferencesCodec,
					},
				}
				: {}),
			aboutContent: {
				version: scriptVersion,
			},
			configuration: {
				codec: preferencesCodec,
				defaults: preferencesDefaults,
				prepareResetPreferences: createReaderPreferencesResetValue,
				customSites: customSites.repository,
				translation: customSites.translation,
				webDav: customSites.webDav?.repository ?? null,
			},
			performanceForm: readerPreferencesPerformanceSettingsAdapter,
			...(customSites.translation
				? {
					translationForm: {
						repository: customSites.translation,
						presentation: {
							readTheme: () =>
								applicationContext.readPreferences().translationTheme,
							persistTheme: (translationTheme) => {
								if (!applicationContext.updatePreferences) {
									throw new Error('当前环境不能保存译文样式');
								}
								applicationContext.updatePreferences({ translationTheme });
							},
						},
					},
				}
				: {}),
			imageForm: readerPreferencesImageAdapter,
			readingForm: readerPreferencesReadingSettingsAdapter,
			interactionForm: {
				boostCopy: readerPreferencesBoostCopyAdapter,
				topicActionRail: readerPreferencesTopicActionRailAdapter,
				replyTree: readerPreferencesReplyTreeAdapter,
				replyTreePreview: replyTreePreferences,
				boostsAvailable: () => discourseNativeBoostsAvailable(
					environment.discourseHost,
				),
			},
		},
		selectHistoryNavigationPreferences: (preferences) => ({
			edgeTriggerPercent: preferences.historyEdgeTriggerPercent,
			buttonsAlwaysVisible: preferences.historyButtonsAlwaysVisible,
		}),
		selectHistoryPanelPreferences: (preferences) => ({
			sortMode: preferences.historySortMode,
		}),
		selectBookmarkPreferences: (preferences) => ({
			tabOrder: preferences.bookmarkTabOrder,
		}),
		selectTimelineViewPreferences: (preferences) => ({
			pageStep: preferences.performancePageSize,
		}),
		...(bodyTranslationAllowed
			? {
				selectTranslationMode: (preferences: ReaderPreferences) =>
					preferences.translationMode,
				persistTranslationMode: (
					translationMode: ReaderPreferences['translationMode'],
				) => persistTranslationMode?.(translationMode),
			}
			: {}),
		targets: {
			openInitialRoute: !suppressInitialTopicOpen,
			serviceWorkerMessages,
			selectOpenTopicsAtFirstPost: (preferences) =>
				preferences.openTopicsAtFirstPost,
			onError: (error) => {
				console.error('[main-lite:target]', error);
			},
		},
		onReady(runtime, context, _settings, settingsView, _layout, appearance, font) {
			state.runtime = runtime;
			persistTranslationMode = (translationMode) => {
				context.updatePreferences?.({ translationMode });
			};
			const storageAccessDocument = document as Document & Readonly<{
				hasStorageAccess?: () => Promise<boolean>;
				requestStorageAccess?: () => Promise<unknown>;
			}>;
			const browserStorage = window.navigator.storage;
			const storageSurface = settingsView
				? new ReaderBrowserStorageManagementSurface({
					document,
					host: settingsView.panelHost('cache'),
					storage: localStorage,
					...(localStorageAccessError === undefined
						? {}
						: { initialAccessError: localStorageAccessError }),
					...(
						typeof storageAccessDocument.hasStorageAccess === 'function' ||
						typeof storageAccessDocument.requestStorageAccess === 'function'
							? {
								storageAccess: {
									...(typeof storageAccessDocument.hasStorageAccess ===
										'function'
										? {
											hasAccess: () => storageAccessDocument
												.hasStorageAccess!(),
										}
										: {}),
									...(typeof storageAccessDocument.requestStorageAccess ===
										'function'
										? {
											requestAccess: () => storageAccessDocument
												.requestStorageAccess!(),
										}
										: {}),
								},
							}
							: {}
					),
					...(browserStorage
						? {
							originStorage: {
								estimate: () => browserStorage.estimate(),
								persisted: () => browserStorage.persisted(),
								persist: () => browserStorage.persist(),
							},
						}
						: {}),
					confirm: (request) => runtime.feedback.confirm(request),
					choose: (request) => runtime.feedback.choose(request),
					notify: (message) => runtime.feedback.show(message),
					openSettings: () => settingsView.open('cache'),
					reload: () => window.location.reload(),
					onError: (cause) => {
						console.error('[main-lite:local-storage]', cause);
					},
					parentScope: runtime.scope,
				})
				: null;
			if (settingsView && storageSurface) {
				let storagePanelVisible = false;
				settingsView.changes.subscribe((snapshot) => {
					const visible = snapshot.open &&
						snapshot.activePanelId === 'cache';
					if (visible && !storagePanelVisible) {
						void storageSurface.refresh({ measureRemaining: true });
					}
					storagePanelVisible = visible;
				}, runtime.scope);
			}
			let storageWarningSettled = storageSurface === null;
			let settingsResetReminderChecked = false;
			const checkSettingsResetReminder = (): void => {
				if (
					!storageWarningSettled ||
					settingsResetReminderChecked ||
					!['opening', 'running', 'failed'].includes(runtime.shell.state)
				) return;
				settingsResetReminderChecked = true;
				void showReaderSettingsResetReminder({
					storage: localStorage,
					preferencesStorageKey: READER_PREFERENCES_STORAGE_KEY,
					defaults: preferencesDefaults,
					prepareResetPreferences: (preferences) =>
						createReaderPreferencesResetValue(
							preferences,
							context.readPreferences(),
						),
					update: (preferences) => {
						if (!context.updatePreferences) {
							throw new Error('偏好写端口不可用');
						}
						context.updatePreferences(preferences);
						requestReaderQueueSurfacePositionsReset(document);
					},
					feedback: runtime.feedback,
					isActive: () => !runtime.scope.destroyed,
					onError: (error) => {
						console.error('[main-lite:settings-reset-reminder]', error);
					},
				});
			};
			if (storageSurface) {
				void storageSurface.warnAtStartup()
					.catch((cause) => {
						console.error('[main-lite:local-storage-warning]', cause);
					})
					.finally(() => {
						storageWarningSettled = true;
						checkSettingsResetReminder();
					});
			}
			const restoreOpenedHostTopicTitle = (): void => {
				if (runtime.shell.state !== 'running') return;
				const topicId = runtime.shell.activeTopicId;
				if (topicId !== null) hostTopicEnhancement?.markTopicOpened(topicId);
			};
			runtime.shell.changes.subscribe(
				() => {
					checkSettingsResetReminder();
					restoreOpenedHostTopicTitle();
				},
				runtime.scope,
			);
			checkSettingsResetReminder();
			restoreOpenedHostTopicTitle();
			const portal = state.portal;
			if (!portal) throw new Error('main-lite Shadow Portal 未就绪');
			const embeddedReload = routeKind === 'list'
				? new ReaderEmbeddedReloadCoordinator({
					target: window,
					storage: window.sessionStorage,
					currentHostRoute: () =>
						`${document.location.pathname}${document.location.search}${document.location.hash}`,
					navigationType: () => {
						const entry = window.performance
							.getEntriesByType?.('navigation')[0] as
								| PerformanceNavigationTiming
								| undefined;
						if (entry?.type) return entry.type;
						const legacy = window.performance as Performance & Readonly<{
							navigation?: Readonly<{ type?: number }>;
						}>;
						return legacy.navigation?.type === 1 ? 'reload' : null;
					},
					capture: () => {
						const workspace = runtime.workspace.workspace.snapshot;
						const topicId = runtime.shell.activeTopicId;
						const active = runtime.shell.activeValue;
						if (
							!workspace.presentation.embedded ||
							topicId === null ||
							!active
						) return null;
						const anchor = runtime.historyNavigation.captureCurrent();
						if (!anchor) return null;
						return Object.freeze({
							mode: workspace.presentation.mode,
							topicId: Number(topicId),
							anchor,
							onlyOp: active.topicOnlyOp.snapshot.enabled,
						});
					},
					restore: async (reload) => {
						if (!runtime.workspace.setMode(reload.mode)) return false;
						const opened = await runtime.openTarget({
							topicId: reload.topicId,
							...(reload.anchor.viewport.scrollRatio === undefined
								? { postNumber: reload.anchor.viewport.postNumber }
								: {}),
							source: 'restore',
							alignment: 'nearest',
						});
						if (
							opened.topic.status !== 'opened' &&
							opened.topic.status !== 'reused'
						) return false;
						if (reload.onlyOp) {
							opened.topic.value.topicOnlyOp.setEnabled(true);
						}
						await runtime.historyNavigation.restore(
							reload.topicId,
							reload.anchor,
						);
						return true;
					},
					parentScope: runtime.scope,
					onError: (error) => {
						console.error('[main-lite:embedded-reload]', error);
					},
				})
				: null;
			void (async () => {
				if (await embeddedReload?.restore()) return;
				if (
					runtime.shell.activeTopicId !== null ||
					!['embed-left', 'embed-right'].includes(
						runtime.workspace.workspace.snapshot.requestedMode,
					) ||
					!runtime.workspace.workspace.snapshot.canEmbed
				) return;
				const recent = runtime.history.ordered('recent-viewed')[0] ?? null;
				if (!recent) return;
				const anchor = runtime.historyNavigation.snapshot.states[
					String(recent.topicId)
				] ?? (recent.viewport === null
					? null
					: normalizeReaderHistoryAnchorState({
						viewport: recent.viewport,
					}));
				const opened = await runtime.openTarget({
					topicId: recent.topicId,
					source: 'restore',
					alignment: 'nearest',
				});
				if (
					anchor &&
					(opened.topic.status === 'opened' ||
						opened.topic.status === 'reused')
				) {
					await runtime.historyNavigation.restore(recent.topicId, anchor, {
						highlight: false,
						restoreSemanticState: false,
					});
				}
			})().catch((error) => {
				console.error('[main-lite:embedded-default-topic]', error);
			});
			const composerWindow = new ReaderNativeComposerWindowController({
				document,
				window,
				mount: portal.root,
				pageRoot: document.documentElement,
				readPreferences: context.readPreferences,
				preferenceChanges: context.preferenceChanges,
				updatePreferences: (patch) => {
					context.updatePreferences?.(patch);
				},
				readFontProfile: () =>
					font?.snapshot.settings.fontProfile ??
					context.readPreferences().fontProfile,
				...(font
					? {
						fontChanges: {
							subscribe(listener, scope) {
								return font.changes.subscribe((snapshot) => {
									listener(snapshot.settings.fontProfile);
								}, scope);
							},
						},
					}
					: {}),
				...(appearance
					? {
						readAppearance: () => appearance.snapshot.interaction,
						appearanceChanges: {
							subscribe(listener, scope) {
								return appearance.changes.subscribe((snapshot) => {
									listener(snapshot.interaction);
								}, scope);
							},
						},
					}
					: {}),
				createMutationObserver: (callback) =>
					new MutationObserver(callback),
				requestFrame: (callback) =>
					window.requestAnimationFrame(callback),
				cancelFrame: (frameId) =>
					window.cancelAnimationFrame(frameId),
				parentScope: runtime.scope,
				onError: (error) => {
					console.error('[main-lite:native-composer-window]', error);
				},
			});
			const unbindComposerWindow = runtime.composer.bindWindow(
				composerWindow,
			);
			// 只读预热宿主 service/module；不提前打开回复框或读取用户草稿。
			runtime.composer.warmReply();
			return () => {
				unbindComposerWindow();
				composerWindow.destroy();
				embeddedReload?.destroy();
				persistTranslationMode = null;
				if (state.runtime === runtime) state.runtime = null;
			};
		},
			});
			return stage.setup(scope, applicationContext);
		},
	});
}

/**
 * 最终 userscript entry 的唯一显式启动函数。
 *
 * 只有 `main-lite-entry.ts` 会调用它；其余模块保持 import-time 无副作用。
 */
export function startMainLiteUserscript(
	userscriptGlobal: unknown = globalThis,
): MainLiteUserscriptHandle | null {
	const environment = new BrowserUserscriptEnvironment({
		userscriptGlobal,
	});
	const page = pageRecord(environment.pageWindow);
	const existing = page[DEBUG_HANDLE_KEY] ?? page[LEGACY_DEBUG_HANDLE_KEY];
	const document = page.document as Document | undefined;
	const window = environment.pageWindow as Window;
	if (!document) throw new Error('main-lite document 不可用');
	let localStorageAccessError: unknown;
	let localStorage: Storage;
	try {
		localStorage = window.localStorage;
	} catch (cause) {
		localStorageAccessError = cause;
		localStorage = unavailableLocalStorage(cause);
	}
	if (isReaderCloudflareChallengeWindow(window)) {
		(existing as MainLiteUserscriptHandle | undefined)?.destroy?.();
		(page[CHALLENGE_MONITOR_KEY] as (() => void) | undefined)?.();
			const stopMonitor = monitorReaderCloudflareChallengeWindow({
				storage: localStorage,
				storageEvents: window,
				broadcastChannelFactory:
					typeof BroadcastChannel === 'function'
						? (name) => new BroadcastChannel(name)
						: null,
				close: () => window.close(),
			schedule: (callback, intervalMs) =>
				window.setInterval(callback, intervalMs),
			cancel: (handle) => window.clearInterval(Number(handle)),
			onError: (error) => {
				console.warn('[main-lite] Cloudflare 验证浮窗自动关闭失败', error);
			},
		});
		Object.defineProperty(page, CHALLENGE_MONITOR_KEY, {
			configurable: true,
			enumerable: false,
			value: stopMonitor,
			writable: false,
		});
		return null;
	}
	if (document.location.hostname === 'credit.linux.do') {
		scheduleReaderCreditAccountBridge(
			window,
			document,
			environment.createValueStorage(),
			environment.createCreditBridgeHttp(),
			(cause) => console.warn('[main-lite] LDC 账户桥同步失败', cause),
		);
		return null;
	}
	const bypassNativeTab = consumeReaderNativeTabBypass(window);
	const bypassNativeUrl = consumeReaderNativeBypass(
		document.location.href,
		document.location.origin,
		(cleanHref) => {
			try {
				window.history.replaceState(
					window.history.state,
					'',
					cleanHref,
				);
			} catch {
				// 地址栏清理失败也不能反向启动 Reader。
			}
		},
	);
	const suppressInitialTopicOpen = bypassNativeTab || bypassNativeUrl;
	if (suppressInitialTopicOpen) {
		(existing as MainLiteUserscriptHandle | undefined)?.destroy?.();
	}
	if (existing && !suppressInitialTopicOpen) {
		return existing as MainLiteUserscriptHandle;
	}
	const serviceWorkerMessages =
		createReaderUserscriptServiceWorkerMessageRelay(
			window.navigator.serviceWorker ?? null,
			(error) => {
				console.error('[main-lite:service-worker-target]', error);
			},
		);
	const valueStorage = environment.createValueStorage();
	const customSiteRepository = new ReaderCustomSiteRepository({
		storage: valueStorage,
	});
	const translation = valueStorage
		? new ReaderTranslationConfigRepository({ storage: valueStorage })
		: null;
	let customSiteProbe: ReaderDiscourseSiteProbeTransportPort | null = null;
	try {
		customSiteProbe = environment.createDiscourseSiteProbe();
	} catch {
		// 缺少 GM_xmlhttpRequest 时仍允许内置站点启动；设置面板会说明不可添加。
	}
	let webDav: Readonly<{
		readonly client: ReaderWebDavClient;
		readonly repository: ReaderWebDavConfigRepository;
	}> | null = null;
	if (valueStorage) {
		try {
			webDav = Object.freeze({
				client: environment.createWebDavClient(),
				repository: new ReaderWebDavConfigRepository({
					storage: valueStorage,
				}),
			});
		} catch {
			// 缺少 GM 跨站请求权限时不挂载 WebDAV 面板。
		}
	}
	const preferences = createReaderPreferencesRepository({
		environment: {
			viewportWidth: window.innerWidth,
			viewportHeight: window.innerHeight,
		},
		storage: localStorage,
	});
	const state: MutableMainLiteState = {
		runtime: null,
		portal: null,
		informationFlow: null,
		diagnostics: [],
	};
	const onWindowKeyDown = (event: KeyboardEvent): void => {
		const runtime = state.runtime;
		if (!runtime) return;
		if (dismissReaderFloatingWindowTabSessionFromEscape(
			runtime.shell.view.surfaceHost,
			event,
		)) return;
		runtime.shell.activeValue?.topicContextSurface
			.handleEscape(event);
	};
	window.addEventListener('keydown', onWindowKeyDown, true);
	const application = createReaderUserscriptApplication({
		environment,
		document,
		window,
		preferences,
		isVerifiedHost: async (hostname, signal) => {
			if (readerBuiltinDiscourseHost(hostname)) return true;
			if (signal.aborted) return false;
			try {
				const verified =
					await customSiteRepository.allows(hostname);
				return !signal.aborted && verified;
			} catch {
				return false;
			}
		},
		stages: [
			createInformationFlowStage(window, valueStorage, preferences, state, [
				{
					domain: 'custom-sites',
					keys: [customSiteRepository.storageKey],
					refresh: () => customSiteRepository.reloadExternal(),
				},
				...(translation
					? [{
						domain: 'translation-config' as const,
						keys: [
							translation.storageKey,
							translation.metadataStorageKey,
						],
						refresh: () => translation.reloadExternalState(),
					}]
					: []),
				...(webDav
					? [{
						domain: 'webdav-config' as const,
						keys: [webDav.repository.storageKey],
						refresh: () => webDav.repository.reloadExternal(),
					}]
					: []),
			]),
			createStyleStage(environment, document, state),
			createRuntimeStage(
				environment,
				document,
				window,
				localStorage,
				localStorageAccessError,
				state,
				serviceWorkerMessages,
				suppressInitialTopicOpen,
				{
					repository: customSiteRepository,
					probe: customSiteProbe,
					translation,
					webDav,
				},
			),
		],
	});
	application.diagnostics.subscribe((diagnostic) => {
		state.diagnostics.push(diagnostic);
		console.error(
			`[main-lite:${diagnostic.stage}]`,
			diagnostic.cause,
		);
	});
	const started = application.start();
	const handle: MainLiteUserscriptHandle = Object.freeze({
		application,
		started,
		get diagnostics() {
			return Object.freeze([...state.diagnostics]);
		},
		get runtime() {
			return state.runtime;
		},
		destroy() {
			window.removeEventListener('keydown', onWindowKeyDown, true);
			try {
				application.destroy();
			} finally {
				serviceWorkerMessages?.destroy();
				if (page[DEBUG_HANDLE_KEY] === handle) {
					delete page[DEBUG_HANDLE_KEY];
				}
				if (page[LEGACY_DEBUG_HANDLE_KEY] === handle) {
					delete page[LEGACY_DEBUG_HANDLE_KEY];
				}
			}
		},
	});
	Object.defineProperty(page, DEBUG_HANDLE_KEY, {
		configurable: true,
		enumerable: false,
		value: handle,
		writable: false,
	});
	Object.defineProperty(page, LEGACY_DEBUG_HANDLE_KEY, {
		configurable: true,
		enumerable: false,
		value: handle,
		writable: false,
	});
	return handle;
}

/** @deprecated 仅用于兼容 1.0.0 及更早的拼写。 */
export type MianLiteUserscriptHandle = MainLiteUserscriptHandle;

/** @deprecated 请改用 startMainLiteUserscript。 */
export const startMianLiteUserscript = startMainLiteUserscript;
