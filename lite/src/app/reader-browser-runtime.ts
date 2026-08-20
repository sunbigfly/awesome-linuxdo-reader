import {
	discourseNativeCurrentUsername,
	discourseNativeBoostsAvailable,
	discourseNativeEmojiMenu,
	discourseNativeEmojiUrl,
	discourseNativeExactTimeFormatter,
	discourseNativeFlagCatalog,
	discourseNativeHostRouteRefresh,
	discourseNativeJqueryModule,
	discourseNativePostAdminMenu,
	discourseNativeRelativeTimeFormatter,
	discourseNativeTopicLinks,
	discourseNativeTopicEditCatalog,
	discourseNativeTopicPresentation,
	discourseNativeUnwantedTopicRuleCatalog,
	BrowserDiscourseNativeBookmarkForm,
	BrowserDiscourseBookmarkNativeState,
	BrowserDiscourseNotificationNativeState,
	type DiscourseHostApiPort,
	type DiscourseNativeExactTimeFormatter,
	type DiscourseNativeFlagType,
	type DiscourseNativeRelativeTimeFormatter,
	type DiscourseNativeTopicPresentationPort,
} from '../discourse/native-host-api.js';
import {
	discourseNativeTargetFailureIsDefinitive,
} from '../discourse/native-request-descriptors.js';
import {
	ReaderCacheManagementSurface,
	type ReaderCacheCategory,
	type ReaderCurrentTopicRefreshResult,
} from '../cache/reader-cache-management-surface.js';
import {
	ReaderCollectionPageRepository,
} from '../cache/reader-collection-page-repository.js';
import {
	ReaderBrowserAssetCacheRepository,
	type BrowserAssetCacheStoragePort,
} from '../cache/browser-asset-cache.js';
import {
	DiscourseApplicationCacheInvalidationCoordinator,
} from '../cache/discourse-application-cache-invalidation.js';
import type {
	PreferencesConfigCodec,
} from '../state/preferences-config-codec.js';
import {
	ReaderSettingsConfigCodec,
	ReaderSettingsConfigManager,
} from '../state/reader-settings-config-manager.js';
import {
	DiscourseComposerCoordinator,
	DiscourseComposerHostIsolation,
	type DiscourseComposerPostInput,
	type DiscourseComposerTopicInput,
} from '../discourse/native-composer.js';
import { ReaderControlTooltip } from '../components/reader-control-tooltip.js';
import { renderReaderIcon } from '../components/reader-icon.js';
import {
	visibleDiscourseNativeFloatingSurface,
} from '../discourse/reader-native-composer-window.js';
import {
	positionReaderNativePostAdminMenu,
} from '../discourse/reader-native-post-admin-menu.js';
import {
	DiscourseNativePostModelFactory,
} from '../discourse/native-post-model-factory.js';
import {
	BrowserDiscoursePresencePort,
} from '../discourse/native-presence.js';
import {
	discoursePostNumber,
	discourseTopicId,
	tryDiscoursePostNumber,
} from '../discourse/identifiers.js';
import type { PostView, PostViewIdentity } from '../dom/post-view.js';
import {
	ReaderHistoryNavigationController,
	type ReaderHistoryOpenResult,
} from '../history/reader-history-navigation-controller.js';
import {
	normalizeReaderHistoryAnchorState,
	type ReaderHistoryAnchorState,
	type ReaderHistoryQuoteHighlightState,
	type ReaderHistoryQuoteSource,
	type ReaderHistoryViewport,
} from '../history/reader-history-model.js';
import {
	ReaderHistoryRepository,
	type ReaderHistoryArchiveMarker,
	type ReaderHistoryEntry,
	type ReaderHistorySortMode,
} from '../history/reader-history-repository.js';
import {
	ReaderHistoryNavigationView,
	type ReaderHistoryNavigationViewPreferences,
} from '../history/reader-history-navigation-view.js';
import {
	ReaderHistoryPanelView,
	type ReaderHistoryPanelPreferences,
	type ReaderHistoryPanelViewOptions,
} from '../history/reader-history-panel-view.js';
import {
	ReaderChronicleRepository,
	readerChronicleHttpStatus,
	readerChronicleRequestTarget,
	type ReaderChronicleInput,
	type ReaderChronicleRequestTarget,
	type ReaderChronicleStatus,
} from '../history/reader-chronicle-repository.js';
import { ReaderChronicleView } from '../history/reader-chronicle-view.js';
import { ReaderUnwantedTopicRepository } from
	'../collection/reader-unwanted-topic-repository.js';
import { ReaderUnwantedTopicView } from
	'../collection/reader-unwanted-topic-view.js';
import type {
	ReaderUnwantedTopicFilterPreferencesPort,
} from '../collection/reader-unwanted-topic-filter.js';
import {
	DiscourseBookmarkRequestAdapter,
} from '../bookmark/discourse-bookmark-adapter.js';
import {
	ReaderBookmarkController,
} from '../bookmark/reader-bookmark-controller.js';
import {
	ReaderBookmarkPanelView,
	type ReaderBookmarkPanelElements,
	type ReaderBookmarkPanelViewOptions,
} from '../bookmark/reader-bookmark-panel-view.js';
import {
	normalizeStoredReaderBookmark,
	sortReaderBookmarkRecords,
	type ReaderBookmarkRecord,
	type ReaderBookmarkTab,
} from '../bookmark/reader-bookmark-model.js';
import { LifecycleScope, type Cleanup } from '../kernel/lifecycle.js';
import { ReaderPostAuthorFilterFeature } from
	'../topic/reader-post-author-filter-feature.js';
import { Signal } from '../kernel/signal.js';
import {
	ReaderTopicLiveNavigationController,
} from '../live/reader-topic-live-navigation-controller.js';
import {
	ReaderResourceMonitor,
} from '../monitor/reader-resource-monitor.js';
import {
	DiscourseNativeAjaxObservationAdapter,
} from '../network/browser-request-observation.js';
import {
	ReaderTopicLiveNavigationView,
	type ReaderTopicLiveNavigationViewElements,
} from '../live/reader-topic-live-navigation-view.js';
import {
	ReaderRateLimitNotice,
} from '../shell/reader-rate-limit-notice.js';
import {
	readerFrontmostEscapeSurface,
	readerSurfaceQuery,
} from '../shell/reader-escape-surface.js';
import {
	BrowserBlobDownloadPort,
	ReaderImageDownloadService,
} from '../media/reader-image-download-service.js';
import {
	ReaderImageResourceService,
	type ObjectUrlPort,
} from '../media/reader-image-resource-service.js';
import {
	ReaderLightboxImagePicker,
} from '../media/reader-lightbox-image-picker.js';
import {
	ReaderMediaPrefetchService,
} from '../media/reader-media-prefetch-service.js';
import {
	ReaderTopicImageIndex,
} from '../media/reader-topic-image-index.js';
import {
	ReaderTopicImageInteraction,
	type ReaderTopicImageOpenRequest,
} from '../media/reader-topic-image-interaction.js';
import {
	ReaderLightboxFeature,
	type ReaderLightboxDefaultSettings,
	type ReaderLightboxPreferencesPort,
} from '../media/reader-lightbox-feature.js';
import {
	ReaderCompactImageViewer,
} from '../media/reader-compact-image-viewer.js';
import type {
	ReaderLightboxCommentPostInput,
} from '../media/reader-lightbox-comment-model.js';
import type {
	ReaderLightboxItem,
} from '../media/reader-lightbox-controller.js';
import type {
	ReaderLightboxOriginalSourcePort,
} from '../media/reader-lightbox-view.js';
import type {
	ReaderImageTransformFrameScheduler,
} from '../media/reader-image-transform-controller.js';
import {
	ReaderTopicMediaFeature,
	type ReaderTopicMediaFeatureOptions,
} from '../media/reader-topic-media-feature.js';
import {
	readerHlsSource,
} from '../media/reader-media-controller.js';
import {
	ReaderCookedContentFeature,
} from '../media/reader-cooked-content-feature.js';
import {
	ReaderTopicPollFeature,
} from '../media/reader-poll-feature.js';
import type {
	ReaderPollViewer,
} from '../media/reader-poll-model.js';
import {
	BrowserSharedRequestPermit,
	browserCloudflareChallengeHref,
	type BrowserSharedRequestPermitOptions,
} from '../network/browser-shared-request-permit.js';
import {
	abortableDelay,
	type RequestTransportResponse,
} from '../network/coordinated-request-client.js';
import {
	BrowserDiscourseNativeAjaxPort,
	BrowserDiscourseNativeMutationTransport,
	BrowserDiscourseNativeReadTransport,
} from '../network/discourse-native-read-transport.js';
import {
	PublicResourceRequestAdapter,
	type PublicResourceRequestAdapterOptions,
} from '../network/public-resource-request-adapter.js';
import type {
	RequestObserver,
	RequestObservationEvent,
	RequestObservationSnapshot,
} from '../network/request-observer.js';
import {
	BrowserDiscourseNativeUserPort,
} from '../user/discourse-native-user-port.js';
import {
	ReaderUserDomainSession,
} from '../user/reader-user-domain-session.js';
import {
	ReaderCreditAccountAdapter,
	type ReaderCreditAccountAdapterOptions,
} from '../user/reader-credit-account-adapter.js';
import {
	ReaderConnectTrustAdapter,
	ReaderConnectTrustHistoryAdapter,
} from '../user/reader-connect-trust-adapter.js';
import {
	ReaderUserEndorsementAdapter,
} from '../user/reader-user-endorsement-adapter.js';
import {
	ReaderUserCardView,
} from '../user/reader-user-card-view.js';
import {
	DiscourseUserObservationAdapter,
} from '../user/discourse-user-observation-adapter.js';
import {
	ReaderUserObservationSession,
} from '../user/reader-user-observation-session.js';
import {
	ReaderUserObservationPageRepository,
} from '../user/reader-user-observation-page-repository.js';
import {
	mergeReaderUserTopicMetadata,
	normalizeReaderUserTopicMetadata,
} from '../user/reader-user-observation-model.js';
import {
	ReaderUserObservationView,
} from '../user/reader-user-observation-view.js';
import {
	ReaderSettingsUserView,
} from '../user/reader-settings-user-view.js';
import {
	DiscourseNotificationRequestAdapter,
} from '../notification/discourse-notification-adapter.js';
import {
	ReaderNotificationController,
} from '../notification/reader-notification-controller.js';
import {
	normalizeStoredReaderNotification,
	sortReaderNotifications,
} from '../notification/reader-notification-model.js';
import {
	ReaderNotificationPanelView,
	type ReaderNotificationPanelElements,
	type ReaderNotificationPanelViewOptions,
} from '../notification/reader-notification-panel-view.js';
import {
	ActionRequestAdapter,
} from '../post/action-request-adapter.js';
import {
	BrowserDiscourseNativeActionPort,
} from '../post/discourse-action-transport.js';
import {
	PostActionController,
	type ActionCommandEvent,
} from '../post/post-action-controller.js';
import {
	DiscourseActionDescriptors,
} from '../post/discourse-action-descriptors.js';
import {
	type CanonicalActionPost,
	PostActionFeatureCommands,
} from '../post/post-action-feature-commands.js';
import {
	UserActionFeatureCommands,
} from '../post/user-action-feature-commands.js';
import {
	DiscoursePostReactionCatalog,
	ReaderPostActionFeature,
} from '../post/reader-post-action-feature.js';
import {
	ReaderBookmarkActionCoordinator,
} from '../post/reader-bookmark-action-coordinator.js';
import {
	ReaderShareActionCoordinator,
	type ReaderShareSurfacePort,
} from '../post/reader-share-action-coordinator.js';
import {
	ReaderTopicNotificationCoordinator,
} from '../post/reader-topic-notification-coordinator.js';
import {
	ReaderTopicSharedIssueCoordinator,
} from '../post/reader-topic-shared-issue-coordinator.js';
import {
	TopicActionFeatureCommands,
	type TopicActionSessionPort,
} from '../post/topic-action-feature-commands.js';
import {
	bindReaderTopicActionRailStarter,
	ReaderTopicActionRail,
	type ReaderTopicActionRailPreferencesAdapter,
	type ReaderTopicActionRailPreferencesPort,
} from '../post/reader-topic-action-rail.js';
import {
	ReaderTopicSummaryImageUploadAdapter,
	ReaderTopicSummaryRequestAdapter,
} from '../post/reader-topic-summary-request-adapter.js';
import {
	ReaderTopicSummarySurface,
	READER_TOPIC_SUMMARY_RESULTS_STORAGE_KEY,
	READER_TOPIC_SUMMARY_SHARE_SETTINGS_KEY,
	READER_TOPIC_SUMMARY_WINDOW_GEOMETRY_STORAGE_KEY_PREFIX,
	type ReaderTopicSummaryFontCatalogPort,
	type ReaderTopicSummaryImagePreview,
} from '../post/reader-topic-summary-surface.js';
import {
	ReaderTopicCustomSummaryRequestAdapter,
} from '../post/reader-topic-custom-summary.js';
import {
	ReaderPostManagementActionCoordinator,
} from '../post/reader-post-management-action-coordinator.js';
import {
	ReaderSelectionQuoteFeature,
} from '../post/reader-selection-quote-feature.js';
import {
	type ReaderShell,
	type ReaderShellOpenResult,
	type ReaderTopicCloseReason,
	type ReaderTopicFactory,
	type ReaderTopicFactoryContext,
} from '../shell/reader-shell.js';
import {
	createReaderShellWorkspaceStage,
	type ReaderShellWorkspaceStageOptions,
	type ReaderWorkspaceCoordinator,
} from '../shell/reader-workspace-coordinator.js';
import {
	ReaderFeedbackSurface,
} from '../shell/reader-feedback-surface.js';
import { ReaderActionSurfaceCoordinator } from '../shell/reader-action-surface-coordinator.js';
import { ReaderExclusivePanelCoordinator } from '../shell/reader-exclusive-panel-coordinator.js';
import {
	ReaderShellRecoveryView,
	type ReaderShellFailureKind,
	type ReaderShellRecoveryFailure,
} from '../shell/reader-shell-recovery-view.js';
import {
	ReaderReportFormSurface,
	type ReaderReportOption,
} from '../shell/reader-report-form-surface.js';
import {
	ReaderAssignmentFormSurface,
} from '../shell/reader-assignment-form-surface.js';
import {
	ReaderChoiceFormSurface,
} from '../shell/reader-choice-form-surface.js';
import {
	ReaderTopicEditFormSurface,
} from '../shell/reader-topic-edit-form-surface.js';
import type {
	ReaderSearchFormsPort,
} from '../search/reader-search.js';
import {
	ReaderSettingsController,
	type ReaderSettingsPanelId,
} from '../settings/reader-settings-controller.js';
import {
	ReaderSettingsView,
} from '../settings/reader-settings-view.js';
import {
	ReaderThemeSettingsControl,
} from '../settings/reader-theme-settings-control.js';
import {
	ReaderWindowSettingsForm,
} from '../settings/reader-window-settings-form.js';
import {
	ReaderShortcutSettingsForm,
} from '../settings/reader-shortcut-settings-form.js';
import {
	ReaderCustomSiteSettingsForm,
} from '../settings/reader-custom-site-settings-form.js';
import {
	ReaderWebDavSettingsForm,
} from '../settings/reader-webdav-settings-form.js';
import {
	CoordinatedDiscourseSiteProbe,
	type ReaderDiscourseSiteProbeTransportPort,
} from '../site/browser-discourse-site-probe.js';
import type {
	ReaderCustomSiteRepository,
} from '../site/reader-custom-site-repository.js';
import type { ReaderWebDavClient } from '../sync/reader-webdav-client.js';
import type { ReaderWebDavConfigRepository } from
	'../sync/reader-webdav-config-repository.js';
import {
	ReaderWebDavAutoSync,
	ReaderWebDavCoordinator,
} from '../sync/reader-webdav-coordinator.js';
import type { ReaderWebDavCategory } from '../sync/reader-webdav-model.js';
import {
	createReaderWebDavCategoryPorts,
	readerWebDavPreferenceRecordMatchesSchema,
} from '../sync/reader-webdav-category-ports.js';
import {
	ReaderPerformanceSettingsForm,
	type ReaderPerformanceSettingsPreferencesAdapter,
} from '../settings/reader-performance-settings-form.js';
import {
	ReaderReadingSettingsForm,
	type ReaderReadingSettingsPreferencesAdapter,
} from '../settings/reader-reading-settings-form.js';
import {
	ReaderTranslationSettingsForm,
	type ReaderTranslationSettingsFormOptions,
} from '../settings/reader-translation-settings-form.js';
import {
	ReaderAiServiceSettingsForm,
} from '../settings/reader-ai-service-settings-form.js';
import type {
	ReaderTranslationConfigRepository,
} from '../translation/reader-translation-config.js';
import {
	ReaderAppearanceSettingsForm,
} from '../settings/reader-appearance-settings-form.js';
import {
	ReaderFontSettingsForm,
} from '../settings/reader-font-settings-form.js';
import {
	ReaderMotionSettingsForm,
	readerMotionNavigationPreferences,
	type ReaderMotionPreferencesAdapter,
} from '../settings/reader-motion-settings-form.js';
import {
	ReaderLayoutSettingsForm,
} from '../settings/reader-layout-settings-form.js';
import {
	ReaderInteractionSettingsForm,
} from '../settings/reader-interaction-settings-form.js';
import {
	ReaderImageSettingsForm,
} from '../settings/reader-image-settings-form.js';
import { ReaderSelectSurface } from '../shell/reader-select-surface.js';
import {
	reloadReaderFloatingWindowTabGeometry,
	restoreReaderFloatingWindowTabSession,
} from '../shell/reader-floating-window-frame.js';
import {
	READER_COLLECTION_FLOATING_WINDOW_GEOMETRY_KEY,
} from '../collection/reader-collection-floating-window.js';
import {
	ReaderImagePreferencesProjection,
	readerImagePresentationMode,
	normalizeReaderImagePreferences,
	type ReaderImagePreferences,
	type ReaderImagePreferencesAdapter,
} from '../media/reader-image-preferences.js';
import {
	DEFAULT_READER_REPLY_TREE_PREFERENCES,
	ReaderReplyTreePresentation,
	type ReaderReplyTreePreferencesAdapter,
	type ReaderReplyTreePreferencesPreviewPort,
} from '../topic/reader-reply-tree-preferences.js';
import {
	ReaderAboutSettingsContent,
} from '../settings/reader-about-settings-content.js';
import {
	ReaderOpenQueueSession,
	requestReaderQueueSurfacePositionsReset,
	type ReaderOpenQueuePreferencesAdapter,
} from '../queue/reader-open-queue-session.js';
import {
	readerTopicDownloadCoverage,
	readerTopicDownloadLocalArchivePlan,
	selectReaderTopicDownloadPosts,
} from '../queue/reader-topic-download-manager.js';
import {
	createReaderTopicOfflineDocument,
	hydrateReaderTopicOfflineDocumentWindow,
	prioritizeReaderTopicOfflineTargetCandidates,
	readerTopicOfflineQuoteTargets,
	type ReaderTopicOfflineDocument,
} from '../archive/reader-topic-offline-document.js';
import {
	ReaderTopicOfflineArtifactRepository,
} from '../archive/reader-topic-offline-artifact-repository.js';
import {
	prepareReaderCookedCallouts,
} from '../media/reader-cooked-content-feature.js';
import { ReaderKatexController } from '../media/reader-katex-controller.js';
import {
	ReaderShortcutController,
	readerShortcutBindingFromEvent,
	type ReaderShortcutPreferencesAdapter,
} from '../shell/reader-shortcut-controller.js';
import type {
	BoostCopyPreferencesAdapter,
	BoostCopySettings,
} from '../post/boost-copy-rule.js';
import {
	ReaderAppearanceStyleController,
	type ReaderAppearancePreferencesAdapter,
} from '../appearance/reader-appearance-style-controller.js';
import {
	ReaderThemeController,
	type ReaderThemeClockPort,
	type ReaderHostThemePort,
	type ReaderSystemThemePort,
	type ReaderThemePreferencesAdapter,
} from '../appearance/reader-theme-controller.js';
import {
	ReaderFontStyleController,
	type ReaderFontPreferencesAdapter,
} from '../font/reader-font-style-controller.js';
import {
	ReaderFontCatalog,
	type ReaderFontCatalogOptions,
} from '../font/reader-font-catalog.js';
import {
	ReaderLoadingAnimationView,
	type ReaderLoadingProgressPort,
} from '../motion/reader-loading-animation-view.js';
import {
	ReaderLayoutStyleController,
	type ReaderLayoutMode,
	type ReaderLayoutPreferencesAdapter,
} from '../layout/reader-layout-style-controller.js';
import {
	createReaderTopicFactory,
	type ReaderTopicFactoryOptions,
	type ReaderTopicRuntimeContext,
} from '../topic/reader-topic-factory.js';
import {
	ReaderTopicNavigationController,
	type ReaderTopicNavigationResult,
	type ReaderTopicNavigationSource,
} from '../topic/reader-topic-navigation-controller.js';
import {
	openReaderNativeTopicTab,
	readerNativeTopicHref,
} from '../topic/reader-native-topic-route.js';
import {
	ReaderTopicFlowController,
	type ReaderTopicFlowScheduler,
} from '../topic/reader-topic-flow-controller.js';
import type {
	ReaderTopicRevealAlignment,
} from '../topic/reader-topic-dom-coordinator.js';
import {
	ReaderTopicNavigationPreferenceProjection,
	type ReaderTopicNavigationPreferences,
} from '../topic/reader-topic-navigation-preferences.js';
import {
	ReaderBoostTargetHighlightController,
	ReaderTopicScrollAdapter,
	type ReaderTopicScrollAdapterOptions,
} from '../topic/reader-topic-scroll-adapter.js';
import {
	ReaderTopicLocalArchiveFeature,
} from '../topic/reader-topic-local-archive-feature.js';
import {
	ReaderTopicTimelineController,
} from '../topic/reader-topic-timeline-controller.js';
import {
	ReaderTopicTimelineView,
	type ReaderTopicTimelineViewElements,
	type ReaderTopicTimelineViewOptions,
	type ReaderTopicTimelineViewPreferences,
} from '../topic/reader-topic-timeline-view.js';
import {
	clearReaderTopicHostIdentityCache,
	normalizeReaderTopicHeader,
	readerTopicOwnerUsername,
	readerTopicHostIdentityCacheStats,
	ReaderTopicHeaderController,
	ReaderTopicHeaderView,
	type ReaderTopicHeaderElements,
} from '../topic/reader-topic-header.js';
import {
	ReaderTopicEditController,
} from '../topic/reader-topic-edit-controller.js';
import {
	ReaderTopicCommentsHeader,
} from '../topic/reader-topic-comments-header.js';
import {
	ReaderTopicOnlyOpController,
} from '../topic/reader-topic-only-op-controller.js';
import {
	ReaderTopicSpecialContentFeature,
} from '../topic/reader-topic-special-content-feature.js';
import {
	ReaderTopicContextController,
} from '../topic/reader-topic-context-controller.js';
import {
	ReaderTopicContextFeature,
	ReaderTopicContextSurface,
} from '../topic/reader-topic-context-surface.js';
import {
	ReaderTopicContextStateRepository,
	readerTopicContextWebStorage,
	type ReaderTopicContextStateStoragePort,
} from '../topic/reader-topic-context-state.js';
import {
	ReaderInformationFlowCoordinator,
} from '../state/reader-information-flow-coordinator.js';
import type {
	ReaderTopicPostFeature,
} from '../topic/reader-topic-dom-coordinator.js';
import {
	discoursePostsFromPayload,
	type TopicSessionCommit,
} from '../topic/topic-session.js';
import type {
	ReaderTopicCoreServices,
} from '../topic/reader-topic-core-bundle.js';
import {
	ReaderTranslationFeature,
	type ReaderTranslationFeatureOptions,
} from '../translation/reader-translation-feature.js';
import type {
	ReaderTranslationMode,
} from '../translation/reader-translation-controller.js';
import {
	TranslationRequestAdapter,
	type ExternalTranslationHttpPort,
	type TranslationRequestAdapterOptions,
} from '../translation/translation-request-adapter.js';
import type {
	ReaderApplicationContext,
	ReaderApplicationStage,
} from './reader-application.js';
import {
	ReaderDataRuntime,
	type ReaderDataRuntimeOptions,
	type ReaderDataTopicBundleOptions,
} from './reader-data-runtime.js';
import {
	readBrowserPerformanceCapabilities,
	readerBulkBackgroundRequestHasHeadroom,
	readerQueuePrefetchRequestHasHeadroom,
	ReaderPerformancePolicy,
	type ReaderPerformancePreferences,
	type ReaderPerformanceSnapshot,
} from './reader-performance-policy.js';

const readerSurfaceOnlyCloseEvents = new WeakSet<Event>();
const hostTopicUserCardSelector =
	'html.ldp-reader-workspace ' +
	':is(.topic-list-item,.latest-topic-list-item) ' +
	':is(.posters,.topic-poster) [data-user-card]';

export function readerWebDavCacheClearPlan(
	categories: readonly ReaderCacheCategory[],
): Readonly<{
	readonly webDavCategories: readonly ReaderWebDavCategory[];
	readonly protectedCategories: readonly ReaderCacheCategory[];
}> {
	const webDavCategories: ReaderWebDavCategory[] = [];
	const protectedCategories: ReaderCacheCategory[] = [];
	if (categories.includes('history')) {
		webDavCategories.push('history');
		protectedCategories.push('history');
	}
	if (categories.includes('notifications')) {
		webDavCategories.push('notification-history');
		protectedCategories.push('notifications');
	}
	if (categories.includes('responses')) {
		webDavCategories.push(
			'bookmarks',
			'translation-cache',
			'activity-history',
		);
		protectedCategories.push('responses');
	}
	return Object.freeze({
		webDavCategories: Object.freeze(webDavCategories),
		protectedCategories: Object.freeze(protectedCategories),
	});
}

export type ReaderBrowserTopicContext<
	TTopic extends DiscourseComposerTopicInput<TPost>,
	TPost extends ReaderLightboxCommentPostInput
		& DiscourseComposerPostInput
		& CanonicalActionPost,
> = ReaderTopicRuntimeContext<
	TTopic,
	TPost,
	ReaderTopicCoreServices<TTopic, TPost>
> & Readonly<{
	readonly topicImages: ReaderTopicImageIndex<TPost>;
	readonly topicImageInteraction: ReaderTopicImageInteraction | null;
	readonly topicLightbox: ReaderLightboxFeature<TTopic, TPost> | null;
	readonly topicMedia: ReaderTopicMediaFeature<TPost>;
	readonly topicCookedContent: ReaderCookedContentFeature<TPost>;
	readonly topicHeader: ReaderTopicHeaderController<TTopic, TPost>;
	readonly topicHeaderView: ReaderTopicHeaderView;
	readonly topicOnlyOp: ReaderTopicOnlyOpController<TPost>;
	readonly topicSpecialContent: ReaderTopicSpecialContentFeature<TTopic, TPost>;
	readonly topicContext: ReaderTopicContextController<TPost>;
	readonly topicContextFeature: ReaderTopicContextFeature<TPost>;
	readonly topicContextSurface: ReaderTopicContextSurface<TPost>;
	readonly topicLiveNavigation: ReaderTopicLiveNavigationController<
		TTopic,
		TPost
	>;
	readonly topicLiveNavigationView: ReaderTopicLiveNavigationView<
		TTopic,
		TPost
	>;
	readonly topicNavigation: ReaderTopicNavigationController<TPost>;
	readonly topicTimeline: ReaderTopicTimelineController;
	readonly topicTimelineView: ReaderTopicTimelineView | null;
	readonly topicFlow: ReaderTopicFlowController<TPost>;
	readonly topicSelectionQuote: ReaderSelectionQuoteFeature<TTopic, TPost>;
	readonly topicActionRail: ReaderTopicActionRail<TPost> | null;
}>;

export interface ReaderBrowserTopicPresentation<TPost> {
	readonly identity: (post: TPost) => PostViewIdentity;
	readonly renderPost: (post: TPost, view: PostView) => void;
	readonly postFeatures: readonly ReaderTopicPostFeature<TPost>[];
}

export interface ReaderBrowserTopicFactoryServices {
	readonly composer: DiscourseComposerCoordinator;
	readonly presentation: DiscourseNativeTopicPresentationPort;
	readonly relativeTime: DiscourseNativeRelativeTimeFormatter;
	readonly exactTime: DiscourseNativeExactTimeFormatter;
	readonly currentUsername: string;
	readonly recoverAvatarSource: (
		source: string,
		signal?: AbortSignal,
	) => Promise<string>;
}

export interface ReaderBrowserLightboxOptions<
	TTopic extends DiscourseComposerTopicInput<TPost>,
	TPost extends ReaderLightboxCommentPostInput
		& DiscourseComposerPostInput
		& CanonicalActionPost,
> {
	readonly mount: HTMLElement | (() => HTMLElement);
	readonly originalSources?: ReaderLightboxOriginalSourcePort;
	readonly confirmOriginalDownload?: (
		missing: number,
		total: number,
	) => boolean | Promise<boolean>;
	readonly originalByDefault?: boolean;
	readonly commentsExpandedByDefault?: boolean;
	readonly descriptionExpandedByDefault?: boolean;
	readonly readDefaults?: () =>
		Readonly<Partial<ReaderLightboxDefaultSettings>>;
	readonly preferences?: ReaderLightboxPreferencesPort;
	readonly commentsEnabled?: boolean;
	readonly frameScheduler?: ReaderImageTransformFrameScheduler;
	readonly onJumpToPost?: (
		item: ReaderLightboxItem,
		context: ReaderBrowserTopicContext<TTopic, TPost>,
	) => void | Promise<void>;
	readonly onClose?: (
		context: ReaderBrowserTopicContext<TTopic, TPost>,
	) => void;
	readonly onError?: (error: unknown) => void;
}

export type SharedBrowserPermitOptions = Omit<
	BrowserSharedRequestPermitOptions,
	| 'storage'
	| 'sourceId'
	| 'locks'
	| 'storageEvents'
	| 'broadcastChannelFactory'
	| 'challenge'
	| 'parentScope'
>;

export type SharedReaderDataOptions = Omit<
	ReaderDataRuntimeOptions,
	| 'permit'
	| 'storage'
	| 'sourceId'
	| 'locks'
	| 'indexedDb'
	| 'broadcastChannelFactory'
	| 'parentScope'
>;

export type ReaderBrowserResourceOptions = Omit<
	PublicResourceRequestAdapterOptions,
	'gateway'
> & Readonly<{
	readonly objectUrls: ObjectUrlPort;
	readonly maxObjectUrls?: number;
	readonly downloadMount?: HTMLElement;
	readonly downloadUrlRevokeAfterMs?: number;
}>;

export interface ReaderBrowserTranslationViewOptions extends Omit<
	ReaderTranslationFeatureOptions,
	| 'document'
	| 'translator'
	| 'buttonHost'
	| 'surfaces'
	| 'initialMode'
	| 'parentScope'
> {
	readonly buttonHost?: HTMLElement;
	readonly initialMode?: ReaderTranslationMode;
}

export type ReaderBrowserNavigationOptions = Omit<
	ReaderTopicScrollAdapterOptions,
	'scrollRoot' | 'parentScope'
>;

export interface ReaderBrowserTimelineViewOptions extends Omit<
	ReaderTopicTimelineViewOptions,
	| 'controller'
	| 'elements'
	| 'readCreatedAt'
	| 'readLatestReplyAt'
	| 'formatRelative'
	| 'parentScope'
	| 'onError'
	| 'notify'
> {
	readonly readPreferences?: () => ReaderTopicTimelineViewPreferences;
	readonly formatRelative?: ReaderTopicTimelineViewOptions['formatRelative'];
	readonly notify?: ReaderTopicTimelineViewOptions['notify'];
}

export interface ReaderBrowserHistoryOptions {
	readonly key?: string;
	readonly maxAgeMs?: number;
	readonly now?: () => number;
	readonly readSortMode?: () => ReaderHistorySortMode;
	readonly navigationView?: Readonly<{
		readonly preferences: ReaderHistoryNavigationViewPreferences;
		readonly window?: Pick<
			Window,
			'addEventListener' | 'removeEventListener'
		> | null;
	}>;
	readonly panelView?: Omit<
		ReaderHistoryPanelViewOptions,
		| 'document'
		| 'mount'
		| 'history'
		| 'elements'
		| 'storage'
		| 'openEntry'
		| 'parentScope'
		| 'onError'
		| 'confirmDelete'
		| 'notify'
	> & Pick<
		Partial<ReaderHistoryPanelViewOptions>,
		'confirmDelete' | 'notify'
	>;
}

export interface ReaderBrowserTargetRequest {
	readonly topicId: number;
	readonly postNumber?: number;
	readonly boostId?: number;
	readonly source: Exclude<ReaderTopicNavigationSource, 'history'>;
	readonly alignment?: ReaderTopicRevealAlignment;
	readonly focus?: boolean;
	readonly highlight?: boolean;
	readonly forceRefresh?: boolean;
	readonly cachedOnly?: boolean;
	readonly revealAsFloor?: boolean;
	readonly localArchive?: Readonly<{
		readonly status: 403 | 404 | 410;
		readonly confirmedAt: number;
		readonly requestPath?: string;
	}>;
	readonly quoteHighlight?: ReaderHistoryQuoteHighlightState;
}

export interface ReaderBrowserNotificationOptions extends Omit<
	ReaderNotificationPanelViewOptions,
	| 'document'
	| 'mount'
	| 'controller'
	| 'elements'
	| 'storage'
	| 'baseUrl'
	| 'relativeTime'
	| 'parentScope'
	| 'notify'
	| 'onError'
> {
	readonly maxCachedPages?: number;
	readonly liveRefreshDelayMs?: number;
	readonly backgroundWarmDelayMs?: number;
	readonly openRevalidateMs?: number;
	readonly nativePollIntervalMs?: number;
	readonly syntheticPollIntervalMs?: number;
	readonly historyStepDelayMs?: number;
	readonly historyRetryDelayMs?: number;
	readonly visibleHistoryConcurrency?: number;
	readonly searchForms?: ReaderSearchFormsPort;
}

export interface ReaderBrowserBookmarkOptions extends Omit<
	ReaderBookmarkPanelViewOptions,
	| 'document'
	| 'mount'
	| 'controller'
	| 'elements'
	| 'storage'
	| 'baseUrl'
	| 'relativeTime'
	| 'parentScope'
	| 'notify'
	| 'onError'
> {
	readonly tabOrder?: readonly ReaderBookmarkTab[];
	readonly pageSize?: number;
	readonly liveRefreshDelayMs?: number;
	readonly backgroundWarmDelayMs?: number;
	readonly visibleHistoryConcurrency?: number;
	readonly changeTabOrder?: (
		order: readonly ReaderBookmarkTab[],
	) => void | Promise<void>;
	readonly searchForms?: ReaderSearchFormsPort;
}

export interface ReaderBrowserBookmarkPreferences {
	readonly tabOrder: readonly ReaderBookmarkTab[];
}

export interface ReaderBrowserBoostCopyOptions {
	readonly readSettings: () => BoostCopySettings;
}

export interface ReaderBrowserCreditOptions {
	readonly http: ExternalTranslationHttpPort;
	readonly storage?: ReaderCreditAccountAdapterOptions['storage'];
}

export interface ReaderBrowserConnectOptions {
	readonly http: ExternalTranslationHttpPort;
}

export interface ReaderBrowserTargetResult<
	TTopic extends DiscourseComposerTopicInput<TPost>,
	TPost extends ReaderLightboxCommentPostInput
		& DiscourseComposerPostInput
		& CanonicalActionPost,
> {
	readonly topic: ReaderShellOpenResult<
		ReaderBrowserTopicContext<TTopic, TPost>
	>;
	readonly navigation: ReaderTopicNavigationResult | null;
}

export interface ReaderBrowserTopicFeatureDiagnostic {
	readonly topicId: number;
	readonly feature:
		| 'image-index'
		| 'image-interaction'
		| 'cooked-content'
		| 'post-media'
		| 'post-action'
		| 'selection-quote'
		| 'topic-header'
		| 'poll'
		| 'special-content'
		| 'thread-context'
		| 'translation'
		| 'navigation'
		| 'history'
		| 'cache'
		| 'notification'
		| 'bookmark'
		| 'user';
	readonly cause: unknown;
}

export interface ReaderBrowserActivityPort {
	visible(): boolean;
	subscribe(listener: () => void): Cleanup;
}

function createReaderBrowserActivity(
	document: Document,
	scope: LifecycleScope,
): ReaderBrowserActivityPort {
	const listeners = new Set<() => void>();
	const publish = (): void => {
		for (const listener of [...listeners]) listener();
	};
	scope.listen(document, 'visibilitychange', publish);
	const view = document.defaultView;
	if (view) {
		scope.listen(view, 'focus', publish);
		scope.listen(view, 'online', publish);
		scope.listen(view, 'pageshow', publish);
		scope.listen(view, 'pagehide', publish);
	}
	scope.add(() => listeners.clear());
	return Object.freeze({
		visible: () => document.visibilityState !== 'hidden',
		subscribe(listener: () => void): Cleanup {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	});
}

export interface ReaderBrowserRuntimeOptions<
	TTopic extends DiscourseComposerTopicInput<TPost>,
	TPost extends ReaderLightboxCommentPostInput
		& DiscourseComposerPostInput
		& CanonicalActionPost,
> {
	readonly shell: ReaderShell<ReaderBrowserTopicContext<TTopic, TPost>>;
	readonly workspace: ReaderWorkspaceCoordinator;
	readonly host: DiscourseHostApiPort;
	readonly share?: ReaderShareSurfacePort;
	readonly document: Document;
	readonly renderIcon?: (name: string, document: Document) => Node;
	readonly storage: Pick<Storage, 'getItem' | 'setItem'>;
	readonly threadContextStorage?: ReaderTopicContextStateStoragePort;
	readonly sourceId: string;
	readonly locks?: Pick<LockManager, 'request'> | null;
	readonly indexedDb?: IDBFactory | null;
	readonly fontStylesheet?: ReaderFontCatalogOptions['appendStylesheet'];
	readonly assetCacheStorage?: BrowserAssetCacheStoragePort | null;
	readonly storageEvents?: EventTarget | null;
	readonly broadcastChannelFactory?: ((name: string) => BroadcastChannel) | null;
	readonly permit: SharedBrowserPermitOptions;
	readonly data: SharedReaderDataOptions;
	readonly performance?: ReaderPerformanceSnapshot;
	readonly openRetryDelay?: (
		milliseconds: number,
		signal: AbortSignal,
	) => Promise<void>;
	readonly loadingProgress?: ReaderLoadingProgressPort;
	readonly topicFlowScheduler?: ReaderTopicFlowScheduler;
	readonly translation?: Omit<TranslationRequestAdapterOptions, 'gateway'>;
	readonly connect?: false | ReaderBrowserConnectOptions;
	readonly credit?: false | ReaderBrowserCreditOptions;
	readonly translationView?: false | ReaderBrowserTranslationViewOptions;
	readonly resources?: ReaderBrowserResourceOptions;
	readonly topic: Omit<
		ReaderDataTopicBundleOptions,
		'host' | 'nativeAjax' | 'onLoadingSource'
	>;
	readonly media?: Omit<
		ReaderTopicMediaFeatureOptions,
		'document' | 'baseUrl' | 'parentScope'
	>;
	readonly navigation?: ReaderBrowserNavigationOptions;
	readonly notifications?: false | ReaderBrowserNotificationOptions;
	readonly bookmarks?: false | ReaderBrowserBookmarkOptions;
	readonly boostCopy?: false | ReaderBrowserBoostCopyOptions;
	readonly topicActionRail?: false | ReaderTopicActionRailPreferencesPort;
	readonly topicSummaryFonts?: ReaderTopicSummaryFontCatalogPort;
	readonly unwantedTopicFilter?: false | ReaderUnwantedTopicFilterPreferencesPort;
	readonly downloadCurrentTopic?: () => void | Promise<void>;
	readonly searchForms?: ReaderSearchFormsPort;
	readonly timelineView?: false | ReaderBrowserTimelineViewOptions;
	readonly history?: ReaderBrowserHistoryOptions;
	readonly lightbox?: ReaderBrowserLightboxOptions<TTopic, TPost>;
	readonly onTopicFeatureError?: (
		diagnostic: ReaderBrowserTopicFeatureDiagnostic,
	) => void;
	readonly openTopicImage?: (
		request: ReaderTopicImageOpenRequest,
		context: ReaderBrowserTopicContext<TTopic, TPost>,
	) => void | Promise<void>;
	readonly topicFactory: Omit<
		ReaderTopicFactoryOptions<
			TTopic,
			TPost,
			ReaderTopicCoreServices<TTopic, TPost>
		>,
		'document'
		| 'createBundle'
		| 'createDomOptions'
		| 'onAssembled'
		| 'onPhase'
		| 'onReady'
	> & Readonly<{
		readonly createDomOptions: (
			...args: [
				...Parameters<
					ReaderTopicFactoryOptions<
						TTopic,
						TPost,
						ReaderTopicCoreServices<TTopic, TPost>
					>['createDomOptions']
				>,
				services: ReaderBrowserTopicFactoryServices,
			]
		) => Omit<
			ReturnType<
				ReaderTopicFactoryOptions<
					TTopic,
					TPost,
					ReaderTopicCoreServices<TTopic, TPost>
				>['createDomOptions']
			>,
			'scroll'
		>;
		readonly onReady?: (
			value: ReaderBrowserTopicContext<TTopic, TPost>,
			context: ReaderTopicFactoryContext,
		) => void | Cleanup;
	}>;
	readonly parentScope?: LifecycleScope;
}

export interface ReaderBrowserRuntimeStageOptions<
	TPreferences extends object,
	TTopic extends DiscourseComposerTopicInput<TPost>,
	TPost extends ReaderLightboxCommentPostInput
		& DiscourseComposerPostInput
		& CanonicalActionPost,
> {
	readonly informationFlow?: ReaderInformationFlowCoordinator;
	readonly shell: Omit<
		ReaderShellWorkspaceStageOptions<
			TPreferences,
			ReaderBrowserTopicContext<TTopic, TPost>
		>,
		'onReady'
	>;
	readonly runtime: Omit<
		ReaderBrowserRuntimeOptions<TTopic, TPost>,
		'shell' | 'workspace' | 'loadingProgress' | 'parentScope'
	>;
	readonly selectNavigationPreferences?: (
		preferences: Readonly<TPreferences>,
	) => ReaderTopicNavigationPreferences;
	readonly selectPerformancePreferences?: (
		preferences: Readonly<TPreferences>,
	) => ReaderPerformancePreferences;
	readonly performanceBudgetCeilings?: Readonly<{
		readonly short: number;
		readonly long: number;
	}>;
	readonly layout?:
		| false
		| ReaderLayoutPreferencesAdapter<TPreferences>;
	readonly appearance?:
		| false
		| ReaderAppearancePreferencesAdapter<TPreferences>;
	readonly theme?:
		| false
		| Readonly<{
			readonly preferences:
				ReaderThemePreferencesAdapter<TPreferences>;
			readonly system: ReaderSystemThemePort;
			readonly clock?: ReaderThemeClockPort;
			readonly hostTheme?: ReaderHostThemePort;
		}>;
	readonly font?:
		| false
		| ReaderFontPreferencesAdapter<TPreferences>;
	readonly motion?:
		| false
		| ReaderMotionPreferencesAdapter<TPreferences> & Readonly<{
			readonly siteName: string;
		}>;
	readonly image?:
		| false
		| ReaderImagePreferencesAdapter<TPreferences>;
	readonly boostCopy?:
		| false
		| BoostCopyPreferencesAdapter<TPreferences>;
	readonly topicActionRail?:
		| false
		| ReaderTopicActionRailPreferencesAdapter<TPreferences>;
	readonly openQueue?:
		| false
		| ReaderOpenQueuePreferencesAdapter<TPreferences>;
	readonly shortcuts?:
		| false
		| ReaderShortcutPreferencesAdapter<TPreferences>;
	readonly settings?: false | Readonly<{
		readonly initialPanelId?: ReaderSettingsPanelId;
		readonly view?: false | Readonly<{
			readonly brandName?: string;
			readonly logoUrl?: string;
		}>;
		readonly performanceForm?:
			| false
			| ReaderPerformanceSettingsPreferencesAdapter<TPreferences>;
		readonly imageForm?:
			| false
			| ReaderImagePreferencesAdapter<TPreferences>;
		readonly readingForm?:
			| false
			| ReaderReadingSettingsPreferencesAdapter<TPreferences>;
		readonly translationForm?:
			| false
			| Readonly<{
				readonly repository: ReaderTranslationConfigRepository;
				readonly presentation: NonNullable<
					ReaderTranslationSettingsFormOptions['presentation']
				>;
			}>;
		readonly interactionForm?:
			| false
			| Readonly<{
				readonly boostCopy:
					BoostCopyPreferencesAdapter<TPreferences>;
				readonly topicActionRail:
					ReaderTopicActionRailPreferencesAdapter<TPreferences>;
				readonly replyTree:
					ReaderReplyTreePreferencesAdapter<TPreferences>;
				readonly replyTreePreview?:
					ReaderReplyTreePreferencesPreviewPort;
				readonly boostsAvailable?: boolean | (() => boolean);
			}>;
		readonly sitesForm?:
			| false
			| Readonly<{
				readonly repository: ReaderCustomSiteRepository;
				readonly probe: ReaderDiscourseSiteProbeTransportPort | null;
			}>;
		readonly webDav?:
			| false
			| Readonly<{
				readonly client: ReaderWebDavClient;
				readonly repository: ReaderWebDavConfigRepository;
				readonly customSites: ReaderCustomSiteRepository;
				readonly preferencesCodec: Pick<
					PreferencesConfigCodec<TPreferences>,
					'export'
				>;
			}>;
		readonly aboutContent?:
			| false
			| Readonly<{
				readonly version: string;
				readonly manualUrl?: string;
			}>;
		readonly configuration?:
			| false
			| Readonly<{
				readonly codec: Pick<
					PreferencesConfigCodec<TPreferences>,
					'export' | 'import'
				>;
				readonly defaults: Readonly<TPreferences>;
				readonly prepareResetPreferences?: (
					defaults: Readonly<TPreferences>,
					current: Readonly<TPreferences>,
				) => Readonly<TPreferences>;
				readonly customSites: ReaderCustomSiteRepository;
				readonly translation: ReaderTranslationConfigRepository | null;
				readonly webDav: ReaderWebDavConfigRepository | null;
			}>;
	}>;
	readonly selectHistoryNavigationPreferences?: (
		preferences: Readonly<TPreferences>,
	) => ReaderHistoryNavigationViewPreferences;
	readonly selectHistoryPanelPreferences?: (
		preferences: Readonly<TPreferences>,
	) => ReaderHistoryPanelPreferences;
	readonly selectBookmarkPreferences?: (
		preferences: Readonly<TPreferences>,
	) => ReaderBrowserBookmarkPreferences;
	readonly selectTimelineViewPreferences?: (
		preferences: Readonly<TPreferences>,
	) => ReaderTopicTimelineViewPreferences;
	readonly selectTranslationMode?: (
		preferences: Readonly<TPreferences>,
	) => ReaderTranslationMode;
	readonly persistTranslationMode?: (mode: ReaderTranslationMode) => void;
	readonly onReady?: (
		runtime: ReaderBrowserRuntime<TTopic, TPost>,
		context: ReaderApplicationContext<TPreferences>,
		settings: ReaderSettingsController<TPreferences> | null,
		settingsView: ReaderSettingsView<TPreferences> | null,
		layout: ReaderLayoutStyleController<TPreferences> | null,
		appearance: ReaderAppearanceStyleController<TPreferences> | null,
		font: ReaderFontStyleController<TPreferences> | null,
	) => void | Cleanup;
}

function readerReportOptions(
	document: Document,
	flagTypes: readonly DiscourseNativeFlagType[],
	availableNames: ReadonlySet<string>,
	appliesTo: string,
): readonly ReaderReportOption[] {
	return Object.freeze(flagTypes
		.filter((flag) =>
			flag.enabled &&
			availableNames.has(flag.nameKey) &&
			(
				!flag.appliesTo.length ||
				flag.appliesTo.includes(appliesTo)
			)
		)
		.map((flag) => {
			const template = document.createElement('template');
			template.innerHTML = flag.description;
			const description = String(
				template.content.textContent ?? '',
			).replace(/\s+/g, ' ').trim();
			return Object.freeze({
				id: flag.id,
				label: flag.label,
				description: description ||
					'提交给社区管理人员审核。',
				requireMessage: flag.requireMessage,
			});
		}));
}

function readerNativeModelValue(value: unknown, key: string): unknown {
	if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
		return undefined;
	}
	const model = value as Readonly<Record<string, unknown>> & Readonly<{
		get?: (name: string) => unknown;
	}>;
	return typeof model.get === 'function' ? model.get(key) : model[key];
}

function readerPollViewer(
	currentUser: unknown,
	fallbackUsername: string,
): ReaderPollViewer {
	const id = Number(readerNativeModelValue(currentUser, 'id'));
	const username = String(
		readerNativeModelValue(currentUser, 'username') ?? fallbackUsername,
	).trim();
	const rawGroups = readerNativeModelValue(currentUser, 'groups');
	const groups = Array.isArray(rawGroups)
		? rawGroups.map((group) => String(
			readerNativeModelValue(group, 'name') ?? group,
		).trim()).filter(Boolean)
		: [];
	return Object.freeze({
		id: Number.isSafeInteger(id) && id > 0 ? id : null,
		username: username || null,
		staff: ['staff', 'admin', 'moderator'].some((key) =>
			readerNativeModelValue(currentUser, key) === true),
		groups: Object.freeze(groups),
	});
}

function readerShellElement<T extends Element>(
	root: HTMLElement,
	selector: string,
	owner: string,
): T {
	const value = root.querySelector<T>(selector);
	if (!value) throw new Error(`${owner} 缺少 Shell 命名控件：${selector}`);
	return value;
}

function readerTopicHeaderElements(
	root: HTMLElement,
): ReaderTopicHeaderElements {
	const query = <T extends Element>(selector: string): T =>
		readerShellElement<T>(root, selector, '主题 Header');
	return Object.freeze({
		titleJump: query<HTMLElement>('.ldp-title-jump'),
		metaHost: query<HTMLElement>('.ldp-meta'),
		metaStats: query<HTMLElement>('.ldp-meta-stats'),
		metaOwner: query<HTMLElement>('.ldp-meta-owner'),
		metaOwnerValue: query<HTMLAnchorElement>('.ldp-meta-owner-value'),
		onlyOpToggle: query<HTMLButtonElement>('.ldp-only-op-toggle'),
		onlyOpProgress: query<HTMLElement>('.ldp-only-op-progress'),
		onlyOpProgressValue:
			query<HTMLElement>('.ldp-only-op-progress-value'),
		topicIdentityHost: query<HTMLElement>('.ldp-title-topic-row'),
	});
}

function readerTopicTimelineElements(
	root: HTMLElement,
): ReaderTopicTimelineViewElements {
	const query = <T extends Element>(selector: string): T =>
		readerShellElement<T>(root, selector, '时间轴 View');
	return Object.freeze({
		root,
		timeline: query<HTMLElement>('.ldp-topic-timeline'),
		date: query<HTMLButtonElement>('.ldp-topic-timeline-date'),
		track: query<HTMLButtonElement>('.ldp-topic-timeline-track'),
		cursor: query<HTMLElement>('.ldp-topic-timeline-cursor'),
		current: query<HTMLElement>('.ldp-topic-timeline-current'),
		total: query<HTMLElement>('.ldp-topic-timeline-total'),
		preview: query<HTMLElement>('.ldp-topic-timeline-preview'),
		relative: query<HTMLButtonElement>('.ldp-topic-timeline-relative'),
		jump: query<HTMLButtonElement>('.ldp-topic-timeline-jump'),
		top: query<HTMLButtonElement>('.ldp-topic-timeline-top'),
		jumpForm: query<HTMLFormElement>('.ldp-topic-timeline-jump-form'),
		jumpInput: query<HTMLInputElement>('.ldp-topic-timeline-jump-input'),
		jumpSubmit: query<HTMLButtonElement>(
			'.ldp-topic-timeline-jump-submit',
		),
		jumpHint: query<HTMLElement>('.ldp-topic-timeline-jump-hint'),
	});
}

function readerTopicLiveNavigationElements(
	root: HTMLElement,
): ReaderTopicLiveNavigationViewElements {
	const liveRoot = root.querySelector<HTMLElement>('.ldp-live-update');
	const jump = root.querySelector<HTMLButtonElement>('.ldp-live-update-jump');
	const label = jump?.querySelector<HTMLElement>('span') ?? null;
	const dismiss = root.querySelector<HTMLButtonElement>(
		'.ldp-live-update-dismiss',
	);
	if (!liveRoot || !jump || !label || !dismiss) {
		throw new Error('实时新回复 View 缺少 Shell 命名控件');
	}
	return Object.freeze({
		root: liveRoot,
		jump,
		label,
		dismiss,
	});
}

function readerNotificationPanelElements(
	root: HTMLElement,
): ReaderNotificationPanelElements {
	const query = <T extends Element>(selector: string): T =>
		readerShellElement<T>(root, selector, '消息面板');
	const modeTabs = [...root.querySelectorAll<HTMLButtonElement>(
		'.ldp-notification-mode-tab',
	)];
	const groupPanels = [...root.querySelectorAll<HTMLElement>(
		'[data-notification-mode-panel]',
	)];
	const groupTabs = [...root.querySelectorAll<HTMLButtonElement>(
		'.ldp-notification-tab',
	)];
	if (modeTabs.length !== 2 || groupPanels.length !== 2 || groupTabs.length !== 14) {
		throw new Error('消息面板必须提供 2 个模式与完整 14 个分类锚点');
	}
	return Object.freeze({
		root,
		toggle: query<HTMLButtonElement>('.ldp-notifications-toggle'),
		badge: query<HTMLElement>('.ldp-notification-unread-badge'),
		popover: query<HTMLElement>('.ldp-notifications-popover'),
		modeTabs: Object.freeze(modeTabs),
		groupPanels: Object.freeze(groupPanels),
		groupTabs: Object.freeze(groupTabs),
		toolbar: query<HTMLElement>('.ldp-notification-toolbar'),
		unreadStatus: query<HTMLButtonElement>('.ldp-notification-unread-status'),
		markAll: query<HTMLButtonElement>('.ldp-notification-mark-all'),
		newMessage: query<HTMLAnchorElement>('.ldp-notification-new-message'),
		search: query<HTMLInputElement>('.ldp-notification-search'),
		searchClear: query<HTMLButtonElement>('.ldp-notification-search-clear'),
		categoryFilter: query<HTMLSelectElement>(
			'.ldp-notification-category-filter',
		),
		tagFilter: query<HTMLSelectElement>('.ldp-notification-tag-filter'),
		list: query<HTMLElement>('.ldp-notification-list'),
		pagePrevious: query<HTMLButtonElement>('.ldp-notification-page-prev'),
		pageInfo: query<HTMLElement>('.ldp-notification-page-info'),
		pageNext: query<HTMLButtonElement>('.ldp-notification-page-next'),
	});
}

function readerBookmarkPanelElements(
	root: HTMLElement,
): ReaderBookmarkPanelElements {
	const query = <T extends Element>(selector: string): T =>
		readerShellElement<T>(root, selector, '收藏面板');
	const tabs = [...root.querySelectorAll<HTMLButtonElement>(
		'.ldp-bookmark-tab',
	)];
	if (tabs.length !== 5) {
		throw new Error(
			'收藏面板必须提供回应、Boost、回复、帖子、楼层五个分类锚点',
		);
	}
	return Object.freeze({
		root,
		toggle: query<HTMLButtonElement>('.ldp-bookmarks-toggle'),
		popover: query<HTMLElement>('.ldp-bookmarks-popover'),
		tabs: Object.freeze(tabs),
		defaultActions: query<HTMLElement>('.ldp-bookmarks-default-actions'),
		multiButton: query<HTMLButtonElement>('.ldp-bookmarks-multi'),
		bulkActions: query<HTMLElement>('.ldp-bookmarks-bulk-actions'),
		selectScope: query<HTMLSelectElement>('.ldp-bookmarks-select-scope'),
		selectToggle: query<HTMLButtonElement>('.ldp-bookmarks-select-toggle'),
		deleteSelected: query<HTMLButtonElement>(
			'.ldp-bookmarks-delete-selected',
		),
		deleteSelectedLabel: query<HTMLElement>(
			'.ldp-bookmarks-delete-selected-label',
		),
		multiDone: query<HTMLButtonElement>('.ldp-bookmarks-multi-done'),
		search: query<HTMLInputElement>('.ldp-bookmarks-search'),
		searchClear: query<HTMLButtonElement>('.ldp-bookmarks-search-clear'),
		categoryFilter: query<HTMLSelectElement>(
			'.ldp-bookmarks-category-filter',
		),
		tagFilter: query<HTMLSelectElement>('.ldp-bookmarks-tag-filter'),
		reactionFilters: query<HTMLElement>('.ldp-reaction-filters'),
		list: query<HTMLElement>('.ldp-bookmarks-list'),
		pagePrevious: query<HTMLButtonElement>('.ldp-bookmarks-page-prev'),
		pageInfo: query<HTMLElement>('.ldp-bookmarks-page-info'),
		pageNext: query<HTMLButtonElement>('.ldp-bookmarks-page-next'),
	});
}

function readerShellFailureKind(cause: unknown): ReaderShellFailureKind {
	if (cause && typeof cause === 'object') {
		const kind = 'kind' in cause ? String(cause.kind ?? '') : '';
		if (
			[
				'cloudflare',
				'rate-limit',
				'authentication',
				'forbidden',
				'not-found',
				'conflict',
				'validation',
				'client',
				'timeout',
				'server',
			].includes(kind)
		) {
			return kind as ReaderShellFailureKind;
		}
		if (
			'cloudflareMitigated' in cause &&
			cause.cloudflareMitigated === true
		) {
			return 'cloudflare';
		}
		const status = 'status' in cause ? Number(cause.status) : 0;
		if (status === 400 || status === 422) return 'validation';
		if (status === 401) return 'authentication';
		if (status === 403) return 'forbidden';
		if (status === 404 || status === 410) return 'not-found';
		if (status === 429) return 'rate-limit';
		if (status === 408) return 'timeout';
		if (status === 409 || status === 412) return 'conflict';
		if (status === 425) return 'server';
		if (status >= 500 && status <= 599) return 'server';
		if (status >= 400 && status <= 499) return 'client';
		const name = 'name' in cause ? String(cause.name ?? '') : '';
		if (name === 'TimeoutError') return 'timeout';
		if (
			name === 'TypeError' ||
			name === 'NetworkError' ||
			name === 'OfflineError'
		) {
			return 'network';
		}
	}
	return 'unknown';
}

function readerShellRecoveryFailure(
	cause: unknown,
	challengeHref: string,
): ReaderShellRecoveryFailure {
	const kind = readerShellFailureKind(cause);
	const copy: Readonly<Record<
		ReaderShellFailureKind,
		readonly [string, string]
	>> = {
		cloudflare: [
			'Cloudflare 验证尚未完成',
			'新的 Reader 请求已暂停，后台不会继续打开新验证页；请手动完成唯一验证后重新加载。',
		],
		'rate-limit': [
			'请求收到 429',
			'当前逻辑请求已按 Retry-After 有界等待；固定预防窗口仍保留真实启动记录。稍后可手动重试，无需刷新页面或清缓存。',
		],
		authentication: [
			'登录状态已失效',
			'服务器返回 401；请先在原站恢复登录，再重新加载当前帖子。',
		],
		forbidden: [
			'当前请求无权限',
			'服务器返回 403；该请求不会被当成 429，也不会触发限流恢复。',
		],
		'not-found': [
			'帖子或楼层不存在',
			'服务器返回 404/410；内容可能已删除、移动或当前账号不可见。',
		],
		conflict: [
			'请求状态发生冲突',
			'服务器返回 409/412；保留当前页面状态，刷新对应内容后再试。',
		],
		validation: [
			'请求内容未通过校验',
			'服务器返回 400/422；不会自动重放，请检查当前输入或页面状态。',
		],
		client: [
			'请求被服务器拒绝',
			'这是当前请求自身的 4xx 异常；不会升级成 429 或全局验证闸门。',
		],
		timeout: [
			'请求超时',
			'有界自动重试仍未恢复；可检查网络后手动重试。',
		],
		network: [
			'网络暂时不可用',
			'当前 Topic 状态未被伪造或清空；网络恢复后可手动重试。',
		],
		server: [
			'服务器暂时不可用',
			'有界自动重试仍未取得成功响应；稍后可继续手动重试。',
		],
		unknown: [
			'帖子加载失败',
			'当前失败已保留为诊断事实；可手动重试或关闭阅读器。',
		],
	};
	return Object.freeze({
		kind,
		message: copy[kind][0],
		detail: copy[kind][1],
		...(kind === 'cloudflare' && challengeHref
			? { challengeHref }
			: {}),
	});
}

function readerShellOpenRetryable(cause: unknown): boolean {
	return ['timeout', 'network', 'server'].includes(
		readerShellFailureKind(cause),
	);
}

function documentTopicId(document: Document): number | null {
	const segments = document.location.pathname.split('/').filter(Boolean);
	const topicIndex = segments.indexOf('t');
	if (topicIndex < 0) return null;
	const tail = segments.slice(topicIndex + 1);
	const topicOffset = /^\d+$/.test(tail[0] ?? '') ? 0 : 1;
	const topicId = Number(tail[topicOffset]);
	return Number.isSafeInteger(topicId) && topicId > 0 ? topicId : null;
}

function createReaderLocalFontQuery(
	document: Document,
): (() => Promise<readonly string[]>) | undefined {
	const browserWindow = document.defaultView as
		| (Window & {
			queryLocalFonts?: () => Promise<
				readonly Readonly<{
					readonly family?: string;
					readonly fullName?: string;
					readonly postscriptName?: string;
				}>[]
			>;
		})
		| null;
	if (!browserWindow?.queryLocalFonts) return undefined;
	let resolved: readonly string[] | null = null;
	let pending: Promise<readonly string[]> | null = null;
	return async () => {
		if (resolved) return resolved;
		if (pending) return pending;
		pending = browserWindow.queryLocalFonts!()
			.then((entries) => Object.freeze([...new Set(
				entries
					.map((entry) => String(
						entry.family ?? entry.fullName ?? entry.postscriptName ?? '',
					).trim())
					.filter(Boolean),
			)].sort((left, right) => left.localeCompare(right))))
			.then((names) => {
				resolved = names;
				return names;
			});
		try {
			return await pending;
		} finally {
			pending = null;
		}
	};
}

/**
 * 浏览器 Reader 的唯一运行时组合根。
 *
 * Shell/Workspace 只拥有页面与窗口；本类只创建一套跨标签许可、数据内核和 Topic factory。
 * Topic 的 HTTP 最终只能进入 Discourse 原生 model/service/plugin/ajax，实时事件只能进入
 * Discourse 原生 message-bus；公共图片 Blob 可选接入唯一无凭据资源端口，但不能用于
 * Discourse API。这里不实现 XHR、CSRF、Cookie 或第二套实时协议。
 */
export class ReaderBrowserRuntime<
	TTopic extends DiscourseComposerTopicInput<TPost>,
	TPost extends ReaderLightboxCommentPostInput
		& DiscourseComposerPostInput
		& CanonicalActionPost,
> {
	readonly scope: LifecycleScope;
	readonly shell: ReaderShell<ReaderBrowserTopicContext<TTopic, TPost>>;
	readonly workspace: ReaderWorkspaceCoordinator;
	readonly permit: BrowserSharedRequestPermit;
	readonly data: ReaderDataRuntime;
	readonly activity: ReaderBrowserActivityPort;
	readonly nativeAjax: BrowserDiscourseNativeAjaxPort;
	readonly userNative: BrowserDiscourseNativeUserPort;
	readonly users: ReaderUserDomainSession;
	readonly connectHistory: ReaderConnectTrustHistoryAdapter | null;
	readonly creditAccount: ReaderCreditAccountAdapter | null;
	readonly userEndorsements: ReaderUserEndorsementAdapter;
	readonly userActions: PostActionController;
	readonly userObservations: ReaderUserObservationSession;
	readonly userObservationView: ReaderUserObservationView;
	readonly userCardView: ReaderUserCardView;
	readonly translationRequests: TranslationRequestAdapter | null;
	readonly translationFeature: ReaderTranslationFeature | null;
	readonly resourceRequests: PublicResourceRequestAdapter | null;
	readonly imageResources: ReaderImageResourceService | null;
	readonly mediaPrefetch: ReaderMediaPrefetchService | null;
	readonly imageDownloads: ReaderImageDownloadService | null;
	readonly blobDownloads: BrowserBlobDownloadPort | null;
	readonly userMediaViewer: ReaderCompactImageViewer | null;
	readonly assetCaches: ReaderBrowserAssetCacheRepository | null;
	readonly postReactions: DiscoursePostReactionCatalog<TTopic, TPost>;
	readonly composerIsolation: DiscourseComposerHostIsolation;
	readonly applicationCacheInvalidation:
		DiscourseApplicationCacheInvalidationCoordinator;
	readonly composer: DiscourseComposerCoordinator;
	readonly controlTooltip: ReaderControlTooltip;
	readonly actionSurfaces: ReaderActionSurfaceCoordinator;
	readonly feedback: ReaderFeedbackSurface;
	readonly recovery: ReaderShellRecoveryView;
	readonly rateLimitNotice: ReaderRateLimitNotice;
	readonly reportForm: ReaderReportFormSurface;
	readonly assignmentForm: ReaderAssignmentFormSurface;
	readonly choiceForm: ReaderChoiceFormSurface;
	readonly topicEditForm: ReaderTopicEditFormSurface;
	readonly selectSurface: ReaderSelectSurface;
	readonly threadContextState: ReaderTopicContextStateRepository;
	readonly history: ReaderHistoryRepository;
	readonly chronicle: ReaderChronicleRepository;
	readonly chronicleView: ReaderChronicleView;
	readonly unwantedTopics: ReaderUnwantedTopicRepository;
	readonly unwantedTopicView: ReaderUnwantedTopicView;
	readonly historyNavigation: ReaderHistoryNavigationController;
	readonly historyNavigationView: ReaderHistoryNavigationView | null;
	readonly historyPanelView: ReaderHistoryPanelView | null;
	readonly notificationNative: BrowserDiscourseNotificationNativeState | null;
	readonly notificationRequests: DiscourseNotificationRequestAdapter | null;
	readonly notificationActions: PostActionController | null;
	readonly notificationController: ReaderNotificationController | null;
	readonly notificationPanelView: ReaderNotificationPanelView | null;
	readonly bookmarkNative: BrowserDiscourseBookmarkNativeState | null;
	readonly bookmarkRequests: DiscourseBookmarkRequestAdapter | null;
	readonly bookmarkActions: PostActionController | null;
	readonly bookmarkController: ReaderBookmarkController | null;
	readonly bookmarkPanelView: ReaderBookmarkPanelView | null;
	readonly #collectionActionEvents = new Signal<ActionCommandEvent>();
	readonly #chronicleRequestIds = new Set<number>();
	readonly #topicSummarySurfaces = new Set<ReaderTopicSummarySurface>();
	readonly topicFactory: ReaderTopicFactory<
		ReaderBrowserTopicContext<TTopic, TPost>
	>;
	#performance: ReaderPerformanceSnapshot;
	#openRecoveryController: AbortController | null = null;
	#lastFailedRequest: ReaderBrowserTargetRequest | null = null;
	readonly #challengeHref: string;
	readonly #openRetryDelay: (
		milliseconds: number,
		signal: AbortSignal,
	) => Promise<void>;
	readonly #loadingProgress: ReaderLoadingProgressPort | null;
	readonly #manualChallengeController: AbortController;
	readonly #boostTargetHighlight: ReaderBoostTargetHighlightController;
	#manualChallengePromise: Promise<boolean> | null = null;
	#destroyed = false;

	constructor(options: ReaderBrowserRuntimeOptions<TTopic, TPost>) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.add(() => this.#collectionActionEvents.clear());
		this.activity = createReaderBrowserActivity(options.document, this.scope);
		this.#manualChallengeController = this.scope.abortController(
			new DOMException('Reader runtime 已销毁', 'AbortError'),
		);
		this.shell = options.shell;
		this.workspace = options.workspace;
		this.#openRetryDelay = options.openRetryDelay ?? abortableDelay;
		this.#loadingProgress = options.loadingProgress ?? null;
		this.#boostTargetHighlight = new ReaderBoostTargetHighlightController({
			...(options.navigation?.readLifetimeMs
				? { readLifetimeMs: options.navigation.readLifetimeMs }
				: {}),
			...(options.navigation?.prefersReducedMotion
				? { prefersReducedMotion: options.navigation.prefersReducedMotion }
				: {}),
			...(options.navigation?.schedule
				? { schedule: options.navigation.schedule }
				: {}),
			...(options.navigation?.cancel
				? { cancel: options.navigation.cancel }
				: {}),
			parentScope: this.scope,
		});
		this.#performance = options.performance ?? Object.freeze({
			pageSize: options.topic.pageSize,
			streamOverscanScreens: 1.5,
			streamMaxMountedPostCount: 80,
			nestedPrefetchScreens: 2.5,
			requestMaxConcurrent: options.data.scheduler.maxConcurrent,
			requestMinIntervalMs: options.permit.minIntervalMs,
			requestRateTargetPercent: 85,
			requestShortBudget: options.permit.shortBudget,
			requestLongBudget: options.permit.longBudget,
		});
		this.assetCaches = options.assetCacheStorage
			? new ReaderBrowserAssetCacheRepository(options.assetCacheStorage)
			: null;
		let challengeHref = '';
		try {
			challengeHref = browserCloudflareChallengeHref(
				options.topic.origin ??
					options.data.rateLimit.baseUrl ??
					options.document.baseURI,
				options.document.location?.href ?? options.document.baseURI,
			);
		} catch {
			// 非 HTTP(S) 测试文档不提供手动验证入口。
		}
		this.#challengeHref = challengeHref;
		const reportTopicFeature = (
			topicId: number,
			feature: ReaderBrowserTopicFeatureDiagnostic['feature'],
			cause: unknown,
		): void => {
			try {
				options.onTopicFeatureError?.(Object.freeze({
					topicId,
					feature,
					cause,
				}));
			} catch {
				// 诊断 consumer 失败不能扩大为领域失败。
			}
		};
		try {
			const nativeUserCatalog =
				discourseNativeUnwantedTopicRuleCatalog(options.host);
			this.selectSurface = new ReaderSelectSurface({
				document: options.document,
				root: this.shell.view.surfaceHost,
				parentScope: this.scope,
			});
			this.actionSurfaces = new ReaderActionSurfaceCoordinator({
				parentScope: this.scope,
			});
			this.controlTooltip = new ReaderControlTooltip({
				document: options.document,
				surfaceHost: this.shell.view.surfaceHost,
				...(options.share
					? { copyText: (value: string) => options.share!.copyText(value) }
					: {}),
				parentScope: this.scope,
			});
			const openNative = this.shell.view.root
				.querySelector<HTMLAnchorElement>('a.ldp-open');
			const browserWindow = options.document.defaultView;
			if (openNative && browserWindow) {
				const openNativeTopic = (event: Event): void => {
					const pointer = event as MouseEvent;
					if (
						(event.type === 'click' && pointer.button !== 0) ||
						(event.type === 'auxclick' && pointer.button !== 1) ||
						!openNative.href ||
						openNative.hidden ||
						!openReaderNativeTopicTab(browserWindow, openNative.href)
					) return;
					event.preventDefault();
					event.stopPropagation();
				};
				this.scope.listen(openNative, 'click', openNativeTopic);
				this.scope.listen(openNative, 'auxclick', openNativeTopic);
			}
			this.feedback = new ReaderFeedbackSurface({
				document: options.document,
				root: this.shell.view.surfaceHost,
				coordinator: this.actionSurfaces,
				...(options.renderIcon
					? { renderIcon: options.renderIcon }
					: {}),
				parentScope: this.scope,
			});
			this.recovery = new ReaderShellRecoveryView({
				document: options.document,
				host: this.shell.view.topicHost,
				onRetry: async () => {
					const request = this.#lastFailedRequest;
					if (!request) return false;
					/* 手动重试只清除短期 429 范围证据，不清共享启动窗口。 */
					await this.data.client.resetRateLimits();
					const result = await this.openTarget({
						...request,
						forceRefresh: true,
					});
					return result.topic.status === 'opened' ||
						result.topic.status === 'reused';
				},
				onClose: async () => {
					await this.close();
				},
				parentScope: this.scope,
			});
			this.reportForm = new ReaderReportFormSurface({
				document: options.document,
				root: this.shell.view.surfaceHost,
				coordinator: this.actionSurfaces,
				...(options.renderIcon
					? { renderIcon: options.renderIcon }
					: {}),
				parentScope: this.scope,
			});
			this.assignmentForm = new ReaderAssignmentFormSurface({
				document: options.document,
				root: this.shell.view.surfaceHost,
				users: nativeUserCatalog,
				coordinator: this.actionSurfaces,
				...(options.renderIcon
					? { renderIcon: options.renderIcon }
					: {}),
				parentScope: this.scope,
			});
			this.choiceForm = new ReaderChoiceFormSurface({
				document: options.document,
				root: this.shell.view.surfaceHost,
				coordinator: this.actionSurfaces,
				...(options.renderIcon
					? { renderIcon: options.renderIcon }
					: {}),
				parentScope: this.scope,
			});
			this.topicEditForm = new ReaderTopicEditFormSurface({
				document: options.document,
				root: this.shell.view.surfaceHost,
				...(options.renderIcon
					? { renderIcon: options.renderIcon }
					: {}),
				parentScope: this.scope,
			});
			this.threadContextState = new ReaderTopicContextStateRepository({
				storage:
					options.threadContextStorage ??
					readerTopicContextWebStorage(options.storage),
				authScope: options.topic.authScope,
				onError: (cause) => reportTopicFeature(
					this.shell.activeTopicId ?? 0,
					'thread-context',
					cause,
				),
			});
			void this.threadContextState.load();
			if (options.lightbox && options.openTopicImage) {
				throw new Error(
					'标准 Lightbox 与自定义 openTopicImage 只能配置一个',
				);
			}
			const challengeOrigin = String(
				options.topic.origin ??
				options.data.rateLimit.baseUrl ??
				options.document.location?.origin ??
				'',
			);
			const challengeWindow = options.document.defaultView;
			this.nativeAjax = new BrowserDiscourseNativeAjaxPort(
				options.host,
				options.topic.origin === undefined
					? {}
					: { origin: options.topic.origin },
			);
			let challengeRequestObserver: RequestObserver | null = null;
			this.permit = new BrowserSharedRequestPermit({
				...options.permit,
				storage: options.storage,
				sourceId: options.sourceId,
				locks: options.locks ?? null,
				storageEvents: options.storageEvents ?? null,
				...(options.broadcastChannelFactory === undefined
					? {}
					: { broadcastChannelFactory: options.broadcastChannelFactory }),
				...(
					/^https?:\/\//i.test(challengeOrigin) &&
					typeof challengeWindow?.open === 'function'
						? {
							challenge: {
								origin: challengeOrigin,
								redirectHref:
									options.document.location?.href ??
									options.document.baseURI,
								verify: async (signal: AbortSignal) => {
									const observer = challengeRequestObserver;
									const observationId = observer?.begin({
										href: '/session/current.json?_=cache-bust',
										method: 'GET',
										transport: 'xmlhttprequest',
										source: 'reader',
										priority: 'critical',
										logicalId: 'CF-probe',
										profile: 'challenge-probe',
										namespace: 'cloudflare-session',
										lane: 'control',
										cacheMode: 'no-store',
										max429Retries: 0,
										maxChallengeRetries: 0,
										blockOnCloudflareChallenge: false,
										suppressAfterChallengeWait: true,
										droppable: false,
										callSite: 'cloudflare-challenge / session-probe',
									}) ?? null;
									let response: RequestTransportResponse<unknown>;
									try {
										response = await this.nativeAjax.request<unknown>({
											path: '/session/current.json',
											method: 'GET',
											signal,
											noStore: true,
										});
									} catch (error) {
										if (observationId !== null) {
											const decision = signal.aborted
												? 'challenge-probe-cancelled'
												: 'challenge-probe-failed';
											const finished = observer?.finish(observationId, {
												error: signal.aborted ? 'AbortError' : 'request-failed',
												decision,
											});
											if (finished === false) {
												observer?.update(observationId, { decision });
											}
										}
										throw error;
									}
									if (observationId !== null) {
										const decision = response.cloudflareMitigated === true
											? 'challenge-probe-blocked'
											: response.status === 429
												? 'challenge-probe-rate-limited-pass'
												: 'challenge-probe-passed';
										const finished = observer?.finish(observationId, {
											status: response.status,
											cloudflareMitigated:
												response.cloudflareMitigated === true,
											retryAfter: String(response.retryAfter ?? ''),
											rateLimitCode: String(response.rateLimitCode ?? ''),
											serverLimit: String(response.serverLimit ?? ''),
											serverRemaining: String(response.serverRemaining ?? ''),
											serverReset: String(response.serverReset ?? ''),
											decision,
										});
										if (finished === false) {
											observer?.update(observationId, { decision });
										}
									}
									/*
									 * 普通 Discourse 429 只说明站点仍在限流，不代表 Cloudflare
									 * challenge 仍存在。这里只验证过盾状态；原有请求管线继续
									 * 独立处理 Retry-After，不能因此把已通过的浮窗退回 required。
									 */
									return response.status >= 100 &&
										response.cloudflareMitigated !== true;
								},
								screen: challengeWindow.screen,
								open: (
									url: string,
									name: string,
									features: string,
								) => challengeWindow.open(
									url,
									name,
									features,
								),
							},
						}
						: {}
				),
				parentScope: this.scope,
			});
			const rateLimitNotice = this.shell.view.root.querySelector<HTMLElement>(
				'.ldp-rate-limit-notice',
			);
			const rateLimitDetail = rateLimitNotice?.querySelector<HTMLElement>(
				'.ldp-rate-limit-detail',
			);
			const rateLimitChallenge = rateLimitNotice?.querySelector<HTMLAnchorElement>(
				'.ldp-rate-limit-challenge',
			);
			if (!rateLimitNotice || !rateLimitDetail || !rateLimitChallenge) {
				throw new Error('Reader Shell 缺少 429 状态投影锚点');
			}
			this.rateLimitNotice = new ReaderRateLimitNotice({
				document: options.document,
				elements: {
					root: rateLimitNotice,
					detail: rateLimitDetail,
					challenge: rateLimitChallenge,
				},
				challengeHref: this.#challengeHref,
				snapshot: () => this.permit.snapshot(),
				subscribe: (listener) =>
					this.permit.subscribeStateChanges(listener),
				parentScope: this.scope,
			});
			this.scope.listen(this.shell.view.root, 'click', (event) => {
				const target = event.target as Element | null;
				const anchor = typeof target?.closest === 'function'
					? target.closest<HTMLAnchorElement>(
						'a.ldp-rate-limit-challenge,a.ldp-error-challenge',
					)
					: null;
				if (!anchor?.href || !this.#challengeHref) return;
				event.preventDefault();
				event.stopPropagation();
				this.#openManualCloudflareChallenge(anchor.href);
			});
			this.data = new ReaderDataRuntime({
				...options.data,
				permit: this.permit,
				storage: options.storage,
				sourceId: options.sourceId,
				locks: options.locks ?? null,
				indexedDb: options.indexedDb ?? null,
				...(options.broadcastChannelFactory === undefined
					? {}
					: { broadcastChannelFactory: options.broadcastChannelFactory }),
				parentScope: this.scope,
			});
			challengeRequestObserver = this.data.requests;
			void this.permit.reconcileCloudflareChallenge()
				.then(() => this.rateLimitNotice.refresh())
				.catch(() => {
					/* runtime 销毁会中止探针；提示继续以共享状态为准。 */
				});
			this.composerIsolation = new DiscourseComposerHostIsolation({
				host: options.host,
				parentScope: this.scope,
				onError: (cause) => reportTopicFeature(
					this.shell.activeTopicId ?? 0,
					'post-action',
					cause,
				),
			});
			this.applicationCacheInvalidation =
				new DiscourseApplicationCacheInvalidationCoordinator({
					host: options.host,
					composerEvents: this.composerIsolation,
					cache: this.data.responses,
					currentTopicId: () => this.shell.activeTopicId === null
						? documentTopicId(options.document)
						: Number(this.shell.activeTopicId),
					onPostChanged: (post) => {
						this.shell.activeValue?.services.live.ingestPostDelta(post);
					},
					parentScope: this.scope,
					onError: (cause) => reportTopicFeature(
						this.shell.activeTopicId ?? 0,
						'post-action',
						cause,
					),
				});
			const nativeActions = new BrowserDiscourseNativeActionPort(
				options.host,
				this.nativeAjax,
				this.composerIsolation,
			);
			const nativeReads = new BrowserDiscourseNativeReadTransport(
				this.nativeAjax,
			);
			const actionDescriptors = new DiscourseActionDescriptors();
			this.userNative = new BrowserDiscourseNativeUserPort(options.host, {
				readTransport: nativeReads,
				...(options.topic.origin === undefined
					? {}
					: { basePath: options.topic.origin }),
				categoryExperts:
					options.document.location?.hostname === 'linux.do',
			});
			this.userEndorsements = new ReaderUserEndorsementAdapter({
				gateway: this.data.gateway,
				transport: nativeReads,
				authScope: options.topic.authScope,
			});
				const connect = options.connect
					? new ReaderConnectTrustAdapter({
					gateway: this.data.gateway,
					http: options.connect.http,
					authScope: options.topic.authScope,
					document: options.document,
					})
					: null;
				this.connectHistory = connect
					? new ReaderConnectTrustHistoryAdapter({
						gateway: this.data.gateway,
						ajax: this.nativeAjax,
						storage: options.storage,
						confirmations: this.data.readCoordination,
						authScope: options.topic.authScope,
					})
					: null;
				if (this.connectHistory) {
					this.scope.add(this.data.readCoordination.subscribeConfirmations(
						(confirmation) => {
							this.connectHistory?.recordReadConfirmation(confirmation);
						},
					));
				}
					this.creditAccount = options.credit
					? new ReaderCreditAccountAdapter({
					gateway: this.data.gateway,
					http: options.credit.http,
					authScope: options.topic.authScope,
					...(options.credit.storage
						? { storage: options.credit.storage }
						: {}),
					})
					: null;
				const credit = this.creditAccount;
			this.users = new ReaderUserDomainSession({
				gateway: this.data.gateway,
				native: this.userNative,
				authScope: options.topic.authScope,
				...(options.searchForms === undefined
					? {}
					: { searchForms: options.searchForms }),
				...(connect ? { connect } : {}),
				...(credit ? { credit } : {}),
				parentScope: this.scope,
				onError: (cause) => reportTopicFeature(
					this.shell.activeTopicId ?? 0,
					'user',
					cause,
				),
			});
			const userAbort = this.scope.abortController(
				new Error('Reader 用户 action scope 已销毁'),
			);
			const userMutation = new ActionRequestAdapter({
				gateway: this.data.gateway,
				nativeActions,
				authScope: options.topic.authScope,
				signal: userAbort.signal,
			});
			this.userActions = new PostActionController({
				mutation: userMutation,
				cache: this.data.responses,
				scope: this.scope,
				onError: (cause) => reportTopicFeature(
					this.shell.activeTopicId ?? 0,
					'user',
					cause,
				),
			});
			const userCommands = new UserActionFeatureCommands({
				state: this.users,
			});
			const setUserNotificationLevel = async (
				username: string,
				level: 'normal' | 'mute' | 'ignore',
				expiringAt?: string,
			): Promise<void> => {
				const binding = this.userNative.actionBinding(username);
				await this.userActions.dispatch(
					userCommands.notificationLevel(
						username,
						level,
						actionDescriptors.userNotificationLevel({
							username,
							user: binding.user,
							level,
							expiringAt: expiringAt ?? null,
							actingUser: binding.actingUser,
						}),
					),
				);
			};
			this.composer = new DiscourseComposerCoordinator({
				host: options.host,
				document: options.document,
				isolation: this.composerIsolation,
				parentScope: this.scope,
				onError: (cause) => {
					try {
						options.lightbox?.onError?.(cause);
					} catch {
						// 诊断 consumer 不得破坏 composer 串行队列。
					}
				},
			});
			this.composer.installSubmitGuard({
				document: options.document,
				parentScope: this.scope,
			});
			const userObservationPresentation =
				discourseNativeTopicPresentation(options.host);
			const userObservationPages = new ReaderUserObservationPageRepository(
				this.data.responses,
				options.topic.authScope,
				this.data.cacheCoordination,
			);
			this.userObservations = new ReaderUserObservationSession({
				requests: new DiscourseUserObservationAdapter({
					gateway: this.data.gateway,
					ajax: this.nativeAjax,
					authScope: options.topic.authScope,
					cache: {
						kind: 'discourse-user-observation',
						tags: ['users', 'user-observation'],
						freshForMs: 10 * 60_000,
						retainForMs: options.topic.caches.posts.retainForMs,
						persist: true,
					},
					categoryName: (categoryId) =>
						userObservationPresentation.categoryName?.(categoryId) ?? '',
				}),
				storage: options.storage,
				pages: userObservationPages,
				authScope: options.topic.authScope,
				historyCoordination: this.data.cacheCoordination,
				historyCoordinationKey:
					`reader-user-observation-history:v1:${options.topic.authScope}`,
				requestResume: (cause) =>
					this.data.client.requestResume(cause),
				notify: (message) => this.feedback.show(message),
				parentScope: this.scope,
				onError: (cause) => reportTopicFeature(
					this.shell.activeTopicId ?? 0,
					'user',
					cause,
				),
			});
			this.scope.add(this.data.cacheCoordination.subscribeInvalidation((query) => {
				this.users.applyExternalCacheInvalidation(query);
				this.userObservations.applyExternalCacheInvalidation(query);
			}));
			this.userObservationView = new ReaderUserObservationView({
					document: options.document,
					mount: this.shell.view.surfaceHost,
					session: this.userObservations,
					storage: options.storage,
					pages: userObservationPages,
					avatarSource: (template, size) =>
						this.userNative.avatarSource(template, size),
					emojiSource: (id) => discourseNativeEmojiUrl(options.host, id),
				openTarget: async (topicId, postNumber, record) => {
					const boostId = record.kind === 'boost'
						? Number(record.identity.match(/^boost:(\d+)$/)?.[1])
						: 0;
					const result = await this.openTarget({
						topicId,
						postNumber,
						...(Number.isSafeInteger(boostId) && boostId > 0
							? { boostId }
							: {}),
						source: 'link',
						highlight: true,
					});
					return (
						result.topic.status === 'opened' ||
						result.topic.status === 'reused'
					) && result.navigation?.status === 'revealed';
				},
				openChallenge: (username) => {
					this.#openManualCloudflareChallenge(
						this.#challengeHref,
						username,
					);
				},
				notify: (message) => this.feedback.show(message),
				parentScope: this.scope,
					onError: (cause) => reportTopicFeature(
						this.shell.activeTopicId ?? 0,
						'user',
						cause,
					),
				});
				this.chronicle = new ReaderChronicleRepository({
					storage: options.storage,
					authScope: options.topic.authScope,
				});
				this.chronicle.load();
					this.chronicleView = new ReaderChronicleView({
					document: options.document,
					mount: this.shell.view.surfaceHost,
					chronicle: this.chronicle,
					storage: options.storage,
					openTarget: async (topicId, postNumber, record) => {
						const result = await this.openTarget({
							topicId,
							postNumber,
							source: 'chronicle',
							highlight: true,
							...(record.kind === 'reply'
								? {
									cachedOnly: true,
									revealAsFloor: true,
									localArchive: Object.freeze({
										status: record.status === 'deleted'
											? 410 as const
											: record.status,
										confirmedAt: record.lastObservedAt,
										requestPath: record.requestPath,
									}),
								}
								: {}),
						});
						return (
							result.topic.status === 'opened' ||
							result.topic.status === 'reused'
						) && result.navigation?.status === 'revealed';
					},
					notify: (message) => this.feedback.show(message),
					parentScope: this.scope,
					onError: (cause) => reportTopicFeature(
						this.shell.activeTopicId ?? 0,
						'history',
						cause,
					),
				});
				this.unwantedTopics = new ReaderUnwantedTopicRepository({
					storage: options.storage,
					authScope: options.topic.authScope,
				});
				this.unwantedTopics.load();
				this.unwantedTopicView = new ReaderUnwantedTopicView({
					document: options.document,
					mount: this.shell.view.surfaceHost,
					topics: this.unwantedTopics,
					...(options.unwantedTopicFilter
						? {
							filterPreferences: options.unwantedTopicFilter,
							filterCatalog: nativeUserCatalog,
						}
						: {}),
					storage: options.storage,
					emojiSource: (id) =>
						discourseNativeEmojiUrl(options.host, id),
					openTarget: async (record) => {
						const result = await this.openTarget({
							topicId: record.topicId,
							postNumber: 1,
							source: 'link',
							highlight: true,
						});
						return result.topic.status === 'opened' ||
							result.topic.status === 'reused';
					},
					notify: (message) => this.feedback.show(message),
					parentScope: this.scope,
					onError: (cause) => reportTopicFeature(
						this.shell.activeTopicId ?? 0,
						'history',
						cause,
					),
				});
				/*
				 * 启动只恢复 IndexedDB 观察索引；缺失本地索引的旧条目等待用户显式刷新。
				 * 禁止进入 Reader/跳楼时为整份观察名单发起历史与 topic_ids 扫描。
				 */
				this.userObservations.resume({ allowNetwork: false });
			this.userCardView = new ReaderUserCardView({
				document: options.document,
				root: this.shell.view.surfaceHost,
				hoverDelegates: Object.freeze([Object.freeze({
					root: options.document,
					selector: hostTopicUserCardSelector,
					capture: true,
				})]),
				session: this.users,
				userHref: (username) =>
					this.userNative.requestIdentity(username),
				avatarSource: (template, size) =>
					this.userNative.avatarSource(template, size),
				recoverAvatarSource: (source: string, signal?: AbortSignal) =>
					this.#recoverAvatarSource(source, signal),
				toggleFollow: async (username, followed) => {
					await this.userActions.dispatch(userCommands.follow(
						username,
						followed,
						actionDescriptors.userFollowToggle({ username, followed }),
						discourseNativeCurrentUsername(options.host),
					));
				},
				openMessage: async (username) => {
					await this.composer.openPrivateMessage(username);
				},
				observeUser: (profile) =>
					this.userObservationView.observe(profile),
				isObserved: (username) =>
					this.userObservations.isObserved(username),
				setNotificationLevel: async (
					username,
					level,
					expiringAt,
				) => {
					await setUserNotificationLevel(username, level, expiringAt);
					this.feedback.show(
						level === 'normal'
							? `已恢复 @${username} 的常规通知`
							: level === 'mute'
								? `已将 @${username} 设为免打扰`
								: `已忽略 @${username}`,
					);
				},
				ignoreUser: (username) => this.choiceForm.open({
					title: `忽略 @${username}`,
					intro: 'Discourse 要求为“忽略”设置截止时间；到期后会自动恢复为常规。',
					fieldLabel: '忽略期限',
					mode: 'select',
					options: Object.freeze([
						Object.freeze({ value: '1', label: '1 天' }),
						Object.freeze({ value: '7', label: '1 周' }),
						Object.freeze({ value: '30', label: '1 个月', selected: true }),
						Object.freeze({ value: '120', label: '4 个月' }),
						Object.freeze({ value: '365', label: '1 年' }),
					]),
					submitLabel: '确认忽略',
					emptySelectionError: '请选择有效的忽略期限',
					submit: async ([value]) => {
						const days = Number(value);
						if (![1, 7, 30, 120, 365].includes(days)) {
							throw new Error('请选择有效的忽略期限');
						}
						await setUserNotificationLevel(
							username,
							'ignore',
							new Date(Date.now() + days * 86_400_000).toISOString(),
						);
						return `已忽略 @${username}`;
					},
				}),
				endorseUser: async (profile) => {
					const username = profile.identity.username;
					const catalog = await this.userEndorsements.load(
						username,
						userAbort.signal,
					);
					if (!catalog.categories.length) {
						throw new Error('当前没有可认可的类别');
					}
					const existingIds = new Set(
						(profile.categoryExperts.endorsements ?? [])
							.map((item) => item.categoryId),
					);
					void this.choiceForm.open({
						title: `认可 @${username}`,
						intro: catalog.remainingEndorsements === null
							? '选择要认可的专家类别。'
							: `今天还可新增 ${catalog.remainingEndorsements} 次认可。`,
						mode: 'multiple',
						options: Object.freeze(catalog.categories.map((category) => {
							const existing = existingIds.has(category.id);
							return Object.freeze({
								value: String(category.id),
								label: category.name,
								selected: existing,
								disabled: existing,
								description: existing
									? '已经认可'
									: '选择后将认可该用户为此类别的专家',
							});
						})),
						submitLabel: '确认认可',
						emptySelectionError: '请选择一个尚未认可的类别',
						submit: async (values) => {
							if (catalog.remainingEndorsements !== null &&
								catalog.remainingEndorsements < 1) {
								throw new Error('今天的认可次数已用完');
							}
							const addedIds = values
								.map(Number)
								.filter((categoryId) =>
									Number.isSafeInteger(categoryId) &&
									categoryId > 0 &&
									!existingIds.has(categoryId));
							if (!addedIds.length) {
								throw new Error('请选择一个尚未认可的类别');
							}
							await this.userActions.dispatch(userCommands.endorse(
								username,
								actionDescriptors.categoryExpertEndorse({
									username,
									categoryIds: Object.freeze([
										...new Set([...existingIds, ...addedIds]),
									]),
								}),
							));
							return '认可已提交';
						},
						signal: userAbort.signal,
					}).catch((cause) => reportTopicFeature(
						this.shell.activeTopicId ?? 0,
						'user',
						cause,
					));
					return true;
				},
				...(options.lightbox
					? {
						openMedia: (
							items,
							initialIndex,
							anchor,
							profile,
							returnFocus,
						) => {
							const viewer = this.userMediaViewer;
							const descriptor = items[initialIndex];
							if (!viewer || !descriptor) {
								throw new Error(
									'用户媒体紧凑查看器尚未装配',
								);
							}
							const item: ReaderLightboxItem = Object.freeze({
								key: `user:${descriptor.kind}:${descriptor.src}`,
								previewSrc: descriptor.src,
								originalSrc: descriptor.originalSrc ?? descriptor.src,
								alt: descriptor.alt,
								topicId: this.shell.activeTopicId ?? 1,
								sourcePostNumber: 1,
								imageOrder: initialIndex,
							});
							viewer.open({
								item,
								kind: descriptor.kind === 'avatar'
									? 'avatar'
									: 'background',
								anchor,
								returnFocus: () => returnFocus ?? anchor,
								outsideSafeSurface: anchor,
								flair: descriptor.kind === 'avatar' ? profile.flair : null,
								...(this.imageDownloads
									? {
										onDownload: async () => {
											await this.imageDownloads!.download(
												item,
												initialIndex,
												{ original: true },
											);
										},
									}
									: {}),
								onDismiss: () => this.userCardView.close(),
							});
						},
					}
					: {}),
				parentScope: this.scope,
				onError: (cause) => reportTopicFeature(
					this.shell.activeTopicId ?? 0,
					'user',
					cause,
				),
			});
			this.#applyPerformanceInfrastructure();
			this.translationRequests = options.translation
				? new TranslationRequestAdapter({
					...options.translation,
					gateway: this.data.gateway,
				})
				: null;
			this.scope.add(() => this.translationRequests?.destroy());
			if (options.translationView === false) {
				this.translationFeature = null;
			} else if (!this.translationRequests) {
				if (options.translationView) {
					throw new Error(
						'翻译 View 需要先配置唯一 TranslationRequestAdapter',
					);
				}
				this.translationFeature = null;
			} else {
				const {
					buttonHost,
					initialMode,
					renderIcon: translationRenderIcon,
					onError: translationOnError,
					...translationViewOptions
				} = options.translationView ?? {};
				const resolvedButtonHost =
					buttonHost ??
					this.shell.view.root.querySelector<HTMLElement>(
						'.ldp-head-btns',
					);
				if (!resolvedButtonHost) {
					throw new Error('翻译 View 缺少稳定 Shell headerActions');
				}
				this.translationFeature = new ReaderTranslationFeature({
					...translationViewOptions,
					document: options.document,
					translator: this.translationRequests,
					buttonHost: resolvedButtonHost,
					surfaces: () => {
						const discussion =
							this.shell.view.modal.querySelector<HTMLElement>(
								':scope > .ldp-descendant-replies-layer',
							);
						return Object.freeze([
							this.shell.view.body,
							...(discussion ? [discussion] : []),
						]);
					},
					...(
						translationRenderIcon
							? { renderIcon: translationRenderIcon }
							: options.renderIcon
								? {
									renderIcon: (document) =>
										options.renderIcon!('languages', document),
								}
								: {}
					),
					initialMode: initialMode ?? 'original',
					parentScope: this.scope,
					notify: (message) => this.feedback.show(message),
					onError: (cause) => {
						try {
							translationOnError?.(cause);
						} catch {
							// 领域诊断不得中断统一翻译队列。
						}
						reportTopicFeature(
							this.shell.activeTopicId ?? 0,
							'translation',
							cause,
						);
					},
				});
			}
			if (options.resources) {
				const {
					objectUrls,
					maxObjectUrls,
					downloadMount,
					downloadUrlRevokeAfterMs,
					...resourceOptions
				} = options.resources;
				this.resourceRequests = new PublicResourceRequestAdapter({
					...resourceOptions,
					gateway: this.data.gateway,
				});
				this.imageResources = new ReaderImageResourceService({
					resources: this.resourceRequests,
					objectUrls,
					...(maxObjectUrls === undefined ? {} : { maxObjectUrls }),
					parentScope: this.scope,
				});
				this.mediaPrefetch = new ReaderMediaPrefetchService({
					document: options.document,
					baseUrl: resourceOptions.baseUrl,
					resources: this.resourceRequests,
					concurrency: 2,
				});
				this.blobDownloads = new BrowserBlobDownloadPort({
					document: options.document,
					mount: downloadMount ??
						options.document.body ??
						options.document.documentElement,
					objectUrls,
					...(downloadUrlRevokeAfterMs === undefined
						? {}
						: { revokeAfterMs: downloadUrlRevokeAfterMs }),
					parentScope: this.scope,
				});
				this.imageDownloads = new ReaderImageDownloadService({
					resources: this.imageResources,
					downloads: this.blobDownloads,
				});
			} else {
				this.resourceRequests = null;
				this.imageResources = null;
				this.mediaPrefetch = null;
				this.imageDownloads = null;
				this.blobDownloads = null;
			}
			this.userMediaViewer = options.lightbox
				? new ReaderCompactImageViewer({
					document: options.document,
					mount: typeof options.lightbox.mount === 'function'
						? options.lightbox.mount()
						: options.lightbox.mount,
					...(this.imageResources || options.lightbox.originalSources
						? {
							originalSources:
								this.imageResources ??
								options.lightbox.originalSources!,
						}
						: {}),
					...(options.lightbox.frameScheduler
						? { frameScheduler: options.lightbox.frameScheduler }
						: {}),
					notify: (message) => this.feedback.show(message),
					parentScope: this.scope,
					onError: (cause) => reportTopicFeature(
						this.shell.activeTopicId ?? 0,
						'user',
						cause,
					),
				})
				: null;
			const {
				onReady: topicReady,
				createDomOptions,
				...topicFactoryOptions
			} = options.topicFactory;
			const topicBaseUrl =
				options.topic.origin ??
				options.data.rateLimit.baseUrl ??
				options.document.baseURI;
			const nativeRelativeTime =
				discourseNativeRelativeTimeFormatter(options.host);
			const nativeExactTime =
				discourseNativeExactTimeFormatter(options.host);
			const nativeTopicPresentation =
				discourseNativeTopicPresentation(options.host);
			const nativeTopicEditCatalog =
				discourseNativeTopicEditCatalog(options.host);
			const nativePresence =
				new BrowserDiscoursePresencePort(options.host);
			const nativeTopicLinks =
				discourseNativeTopicLinks(options.host, topicBaseUrl);
			const topicSummaryTransport = (() => {
				try {
					const hostname = new URL(
						topicBaseUrl,
						options.document.baseURI,
					).hostname.toLocaleLowerCase();
					return hostname === 'linux.do'
						? new BrowserDiscourseNativeMutationTransport(this.nativeAjax)
						: null;
				} catch {
					return null;
				}
			})();
			const nativeFlagCatalog =
				discourseNativeFlagCatalog(options.host);
			const nativeEmojiMenu =
				discourseNativeEmojiMenu(options.host);
			const nativeAdminMenu =
				discourseNativePostAdminMenu(options.host, {
					computePosition: (anchor, content) => {
						positionReaderNativePostAdminMenu({
							document: options.document,
							reader: this.shell.view.modal,
							anchor,
							content,
						});
					},
				});
			const nativePostModels =
				new DiscourseNativePostModelFactory(options.host);
			const nativeBookmarkForm =
				new BrowserDiscourseNativeBookmarkForm(options.host);
			this.postReactions =
				new DiscoursePostReactionCatalog<TTopic, TPost>(
					nativePostModels,
				);
			const postReactions = this.postReactions;
			const topicFeatures = new WeakMap<
				LifecycleScope,
				Readonly<{
					topicImages: ReaderTopicImageIndex<TPost>;
					topicMedia: ReaderTopicMediaFeature<TPost>;
					topicCookedContent: ReaderCookedContentFeature<TPost>;
					topicSpecialContent:
						ReaderTopicSpecialContentFeature<TTopic, TPost>;
					topicContext: ReaderTopicContextController<TPost>;
					topicContextFeature: ReaderTopicContextFeature<TPost>;
					highlightDiscussionTarget: (target: HTMLElement) => void;
					presentation: ReaderBrowserTopicPresentation<TPost>;
					topicPostActions: ReaderPostActionFeature<TTopic, TPost>;
					topicActionRail: ReaderTopicActionRail<TPost> | null;
				}>
			>();
			const topicDoms = new WeakMap<
				LifecycleScope,
				Readonly<{
					notifyScroll(): void;
					notifyContentLayoutChanged(): void;
					revealNextReplyLevel(postNumber: number): boolean;
				}>
			>();
			const topicContextSurfaces = new WeakMap<
				LifecycleScope,
				ReaderTopicContextSurface<TPost>
			>();
			const topicHeaders = new WeakMap<
				LifecycleScope,
				ReaderTopicHeaderController<TTopic, TPost>
			>();
			const topicHeaderViews = new WeakMap<
				LifecycleScope,
				ReaderTopicHeaderView
			>();
			const topicOnlyOpControllers = new WeakMap<
				LifecycleScope,
				ReaderTopicOnlyOpController<TPost>
			>();
			const topicNavigations = new WeakMap<
				LifecycleScope,
				ReaderTopicNavigationController<TPost>
			>();
			const topicFlows = new WeakMap<
				LifecycleScope,
				ReaderTopicFlowController<TPost>
			>();
			const topicTimelines = new WeakMap<
				LifecycleScope,
				ReaderTopicTimelineController
			>();
			const topicTimelineViews = new WeakMap<
				LifecycleScope,
				ReaderTopicTimelineView
			>();
			const topicLiveNavigations = new WeakMap<
				LifecycleScope,
				ReaderTopicLiveNavigationController<TTopic, TPost>
			>();
			const topicLiveNavigationViews = new WeakMap<
				LifecycleScope,
				ReaderTopicLiveNavigationView<TTopic, TPost>
			>();
			const topicSummaryPreviews = new WeakMap<
				LifecycleScope,
				{ open: ((input: ReaderTopicSummaryImagePreview) => void) | null }
			>();
			const authenticatedCollectionScope =
				options.topic.authScope.startsWith('account:');
			if (
				options.notifications === false ||
				!authenticatedCollectionScope
			) {
				this.notificationNative = null;
				this.notificationRequests = null;
				this.notificationActions = null;
				this.notificationController = null;
				this.notificationPanelView = null;
			} else {
				const notificationOptions = options.notifications ?? {};
				const notificationAbort = this.scope.abortController(
					new Error('Reader 通知 application scope 已销毁'),
				);
				this.notificationNative =
					new BrowserDiscourseNotificationNativeState(options.host);
				this.notificationRequests =
					new DiscourseNotificationRequestAdapter({
						gateway: this.data.gateway,
						ajax: this.nativeAjax,
						native: this.notificationNative,
						authScope: options.topic.authScope,
						signal: notificationAbort.signal,
						...(options.topic.basePath === undefined
							? {}
							: { basePath: options.topic.basePath }),
						replyExpansionCache: {
							kind: 'discourse-topic-posts',
							tags: ['notifications'],
							...options.topic.caches.posts,
						},
						categoryNameFor: (categoryId) =>
							userObservationPresentation.categoryName?.(categoryId) ?? '',
					});
				const notificationMutation = new ActionRequestAdapter({
					gateway: this.data.gateway,
					nativeActions,
					authScope: options.topic.authScope,
					signal: notificationAbort.signal,
				});
				this.notificationActions = new PostActionController({
					mutation: notificationMutation,
					cache: this.data.responses,
					scope: this.scope,
					onError: (cause) => reportTopicFeature(
						this.shell.activeTopicId ?? 0,
						'notification',
						cause,
					),
				});
				this.notificationController =
					new ReaderNotificationController({
						requests: this.notificationRequests,
						projection: new ReaderCollectionPageRepository({
							responses: this.data.responses,
							authScope: options.topic.authScope,
							namespace: 'notifications',
							kind: 'reader-notification-projection',
							tags: ['notification-projection'],
							normalizeRecord: normalizeStoredReaderNotification,
							sortRecords: sortReaderNotifications,
							pageSize: 60,
							retainForMs: 180 * 24 * 60 * 60_000,
							permanent: true,
							coordination: this.data.cacheCoordination,
						}),
						native: this.notificationNative,
						actions: this.notificationActions,
						cache: this.data.responses,
						target: {
							openTarget: async (request) => {
								const result = await this.openTarget(request);
								return (
									result.topic.status === 'opened' ||
									result.topic.status === 'reused'
								) && result.navigation?.status === 'revealed';
							},
						},
						...(notificationOptions.maxCachedPages === undefined
							? {}
							: {
								maxCachedPages:
									notificationOptions.maxCachedPages,
							}),
						...(notificationOptions.liveRefreshDelayMs === undefined
							? {}
							: {
								liveRefreshDelayMs:
									notificationOptions.liveRefreshDelayMs,
							}),
						backgroundWarmDelayMs:
							notificationOptions.backgroundWarmDelayMs ?? 1_800,
						...(notificationOptions.openRevalidateMs === undefined
							? {}
							: {
								openRevalidateMs:
									notificationOptions.openRevalidateMs,
							}),
						...(notificationOptions.nativePollIntervalMs === undefined
							? {}
							: {
								nativePollIntervalMs:
									notificationOptions.nativePollIntervalMs,
							}),
						...(notificationOptions.syntheticPollIntervalMs === undefined
							? {}
							: {
								syntheticPollIntervalMs:
									notificationOptions.syntheticPollIntervalMs,
							}),
						...(notificationOptions.historyStepDelayMs === undefined
							? {}
							: {
								historyStepDelayMs:
									notificationOptions.historyStepDelayMs,
							}),
						...(notificationOptions.historyRetryDelayMs === undefined
							? {}
							: {
								historyRetryDelayMs:
									notificationOptions.historyRetryDelayMs,
							}),
						visibleHistoryConcurrency:
							notificationOptions.visibleHistoryConcurrency ?? 3,
						historyCoordination: this.data.cacheCoordination,
						historyCoordinationKey:
							`reader-notification-history:v1:${options.topic.authScope}`,
						activity: this.activity,
						...(notificationOptions.schedule === undefined
							? {}
							: { schedule: notificationOptions.schedule }),
						...(notificationOptions.cancel === undefined
							? {}
							: { cancel: notificationOptions.cancel }),
						...((notificationOptions.searchForms ??
							options.searchForms) === undefined
							? {}
							: {
								searchForms:
									notificationOptions.searchForms ??
									options.searchForms,
							}),
						parentScope: this.scope,
						onError: (cause) => reportTopicFeature(
							this.shell.activeTopicId ?? 0,
							'notification',
							cause,
						),
					});
				this.notificationPanelView =
					new ReaderNotificationPanelView({
						...notificationOptions,
						...(
							notificationOptions.renderIcon
								? {}
								: options.renderIcon
									? { renderIcon: options.renderIcon }
									: {}
						),
						document: options.document,
						mount: this.shell.view.surfaceHost,
						storage: options.storage,
						controller: this.notificationController,
						elements: readerNotificationPanelElements(
							this.shell.view.root,
						),
						baseUrl: topicBaseUrl,
						relativeTime: nativeRelativeTime,
						emojiSource: notificationOptions.emojiSource ?? ((id) =>
							discourseNativeEmojiUrl(options.host, id)),
						archiveMarker: (topicId, postNumber) =>
							this.#historyArchiveMarker(topicId, postNumber),
						notify: (message) => this.feedback.show(message),
						parentScope: this.scope,
							onError: (cause) => reportTopicFeature(
								this.shell.activeTopicId ?? 0,
								'notification',
								cause,
							),
						});
					}
			if (
				options.bookmarks === false ||
				!authenticatedCollectionScope
			) {
				this.bookmarkNative = null;
				this.bookmarkRequests = null;
				this.bookmarkActions = null;
				this.bookmarkController = null;
				this.bookmarkPanelView = null;
			} else {
				const bookmarkOptions = options.bookmarks ?? {};
				const bookmarkAbort = this.scope.abortController(
					new Error('Reader 收藏 application scope 已销毁'),
				);
				this.bookmarkNative =
					new BrowserDiscourseBookmarkNativeState(options.host);
				this.bookmarkRequests =
					new DiscourseBookmarkRequestAdapter({
						gateway: this.data.gateway,
						ajax: this.nativeAjax,
						native: this.bookmarkNative,
						authScope: options.topic.authScope,
						signal: bookmarkAbort.signal,
						cache: {
							kind: 'discourse-bookmark-collection',
							tags: [
								'bookmarks',
								'reactions-given',
								'boosts-given',
								'replied-topics',
							],
							freshForMs: 30 * 60_000,
							retainForMs:
								options.topic.caches.posts.retainForMs,
							persist: true,
						},
						categoryNameFor: (categoryId) =>
							userObservationPresentation.categoryName?.(categoryId) ?? '',
					});
				const bookmarkMutation = new ActionRequestAdapter({
					gateway: this.data.gateway,
					nativeActions,
					authScope: options.topic.authScope,
					signal: bookmarkAbort.signal,
				});
				this.bookmarkActions = new PostActionController({
					mutation: bookmarkMutation,
					cache: this.data.responses,
					scope: this.scope,
					onError: (cause) => reportTopicFeature(
						this.shell.activeTopicId ?? 0,
						'bookmark',
						cause,
					),
				});
				this.bookmarkController = new ReaderBookmarkController({
					requests: this.bookmarkRequests,
					projection: new ReaderCollectionPageRepository<ReaderBookmarkRecord>({
						responses: this.data.responses,
						authScope: options.topic.authScope,
						namespace: 'bookmarks',
						kind: 'reader-bookmark-projection',
						tags: ['bookmark-projection'],
						normalizeRecord: normalizeStoredReaderBookmark,
						sortRecords: sortReaderBookmarkRecords,
						pageSize: 60,
						retainForMs: 180 * 24 * 60 * 60_000,
						permanent: true,
						coordination: this.data.cacheCoordination,
					}),
					native: this.bookmarkNative,
					actions: this.bookmarkActions,
					reactionEvents: this.#collectionActionEvents,
					activityEvents: this.#collectionActionEvents,
					cache: this.data.responses,
					target: {
						openTarget: async (request) => {
							const result = await this.openTarget(request);
							return (
								result.topic.status === 'opened' ||
								result.topic.status === 'reused'
							) && result.navigation?.status === 'revealed';
						},
					},
					...(bookmarkOptions.tabOrder === undefined
						? {}
						: { tabOrder: bookmarkOptions.tabOrder }),
					...(bookmarkOptions.pageSize === undefined
						? {}
						: { pageSize: bookmarkOptions.pageSize }),
						...(bookmarkOptions.liveRefreshDelayMs === undefined
							? {}
							: {
								liveRefreshDelayMs:
									bookmarkOptions.liveRefreshDelayMs,
							}),
						backgroundWarmDelayMs:
							bookmarkOptions.backgroundWarmDelayMs ?? 2_400,
						visibleHistoryConcurrency:
							bookmarkOptions.visibleHistoryConcurrency ?? 3,
						historyCoordination: this.data.cacheCoordination,
						historyCoordinationKey:
							`reader-bookmark-history:v1:${options.topic.authScope}`,
						activity: this.activity,
						...(bookmarkOptions.changeTabOrder === undefined
						? {}
						: {
							changeTabOrder:
								bookmarkOptions.changeTabOrder,
						}),
					...((bookmarkOptions.searchForms ??
						options.searchForms) === undefined
						? {}
						: {
							searchForms:
								bookmarkOptions.searchForms ??
								options.searchForms,
						}),
					parentScope: this.scope,
					onError: (cause) => reportTopicFeature(
						this.shell.activeTopicId ?? 0,
						'bookmark',
						cause,
					),
				});
				this.bookmarkPanelView = new ReaderBookmarkPanelView({
					...bookmarkOptions,
					...(
						bookmarkOptions.renderIcon
							? {}
							: options.renderIcon
								? { renderIcon: options.renderIcon }
								: {}
					),
					document: options.document,
					mount: this.shell.view.surfaceHost,
					storage: options.storage,
					controller: this.bookmarkController,
					elements: readerBookmarkPanelElements(
						this.shell.view.root,
					),
					baseUrl: topicBaseUrl,
					relativeTime: nativeRelativeTime,
					emojiSource: bookmarkOptions.emojiSource ?? ((id) =>
						discourseNativeEmojiUrl(options.host, id)),
					archiveMarker: (topicId, postNumber) =>
						this.#historyArchiveMarker(topicId, postNumber),
					reactionIconSource:
						bookmarkOptions.reactionIconSource ??
						((reaction) => discourseNativeEmojiUrl(
							options.host,
							reaction,
						)),
					confirmDelete:
						bookmarkOptions.confirmDelete ??
						((request) => this.feedback.confirm({
							title: request.title,
							message: request.message,
							note: '该操作会同步到 Discourse 收藏。',
							confirmLabel: request.confirmLabel,
							tone: 'danger',
							details: [{
								label: '收藏数量',
								value: String(request.count),
							}],
						})),
					notify: (message) => this.feedback.show(message),
					parentScope: this.scope,
						onError: (cause) => reportTopicFeature(
							this.shell.activeTopicId ?? 0,
							'bookmark',
							cause,
						),
					});
					}
			/* 私有集合继续由各自浮窗拥有，不接入用户观察字段或进度。 */
			this.notificationController?.startBackgroundCache();
			this.bookmarkController?.startBackgroundCache();
			const selfObservationUsername =
				discourseNativeCurrentUsername(options.host);
			if (selfObservationUsername) {
				const currentUser = options.host.lookup('service:current-user');
				this.userObservations.observeSelf({
					username: selfObservationUsername,
					name: String(readerNativeModelValue(currentUser, 'name') ?? '')
						.trim(),
					avatarTemplate: String(
						readerNativeModelValue(currentUser, 'avatar_template') ?? '',
					).trim(),
				});
			}
			const coreTopicFactory = createReaderTopicFactory<
				TTopic,
				TPost,
				ReaderTopicCoreServices<TTopic, TPost>
			>({
				...topicFactoryOptions,
				document: options.document,
				onPhase: (phase, context) => {
					options.loadingProgress?.update({
						topicId: Number(context.topicId),
						phase,
					});
				},
				createDomOptions: (bundle, context, root) => {
					bundle.services.actions.events.subscribe(
						(event) => this.#collectionActionEvents.emit(event),
						context.scope,
					);
					const currentUsername =
						discourseNativeCurrentUsername(options.host);
					const topicImages = new ReaderTopicImageIndex<TPost>({
						document: options.document,
						baseUrl: topicBaseUrl,
						topicId: context.topicId,
						session: bundle.services.session,
						parentScope: context.scope,
						onError: (cause) => reportTopicFeature(
							context.topicId,
							'image-index',
							cause,
						),
					});
					const {
						onError: mediaOnError,
						visibility: mediaVisibility,
						renderRetryIcon,
						onLayoutChanged: mediaImageLayoutChanged,
						onContentLayoutChanged:
							mediaContentLayoutChanged,
						...mediaOptions
					} = options.media ?? {};
					const notifyTopicLayoutChanged = (): void => {
						topicDoms.get(context.scope)
							?.notifyContentLayoutChanged();
					};
					const topicMedia = new ReaderTopicMediaFeature<TPost>({
						...mediaOptions,
						...(options.renderIcon
							? { renderIcon: options.renderIcon }
							: {}),
						...(
							renderRetryIcon
								? { renderRetryIcon }
								: options.renderIcon
									? {
										renderRetryIcon: (document) =>
											options.renderIcon!(
												'rotate-ccw',
												document,
											),
									}
									: {}
						),
						document: options.document,
						baseUrl: topicBaseUrl,
						visibility: mediaVisibility ??
							(() => options.document.visibilityState),
						onLayoutChanged: (image) => {
							mediaImageLayoutChanged?.(image);
							notifyTopicLayoutChanged();
						},
						onContentLayoutChanged: (root) => {
							mediaContentLayoutChanged?.(root);
							notifyTopicLayoutChanged();
						},
						parentScope: context.scope,
						onError: (cause) => {
							try {
								mediaOnError?.(cause);
							} catch {
								// 领域诊断同样不得破坏其他媒体。
							}
							reportTopicFeature(
								context.topicId,
								'post-media',
								cause,
							);
						},
					});
					const topicCookedContent =
						new ReaderCookedContentFeature<TPost>({
							document: options.document,
							mount: this.shell.view.modal,
							baseUrl: topicBaseUrl,
							...(options.share
								? { clipboard: options.share }
								: {}),
							...(this.blobDownloads
								? { downloads: this.blobDownloads }
								: {}),
							notify: (message) => this.feedback.show(message),
							onLayoutChanged: notifyTopicLayoutChanged,
							onPrepared: (root) => {
								this.translationFeature?.syncPost(root);
							},
							parentScope: context.scope,
							onError: (cause) => reportTopicFeature(
								context.topicId,
								'cooked-content',
								cause,
							),
						});
					const domOptions = createDomOptions(
						bundle,
						context,
						root,
						Object.freeze({
							composer: this.composer,
							presentation: nativeTopicPresentation,
							relativeTime: nativeRelativeTime,
							exactTime: nativeExactTime,
							currentUsername,
							recoverAvatarSource: (source: string, signal?: AbortSignal) =>
								this.#recoverAvatarSource(source, signal),
							}),
					);
					const replyTreePresentation =
						domOptions.replyTreePresentation ??
						new ReaderReplyTreePresentation(
							bundle.replies.topology,
							domOptions.replyTreePreferences?.read(),
							{
								canonicalCoverageComplete: () =>
									bundle.replies.coverage().complete,
								canonicalPostStreamRevision: () =>
									bundle.session.postStreamRevision ?? 0,
								canonicalPostStreamGapCount: (
									postNumber,
									previousRootPostNumber,
								) => bundle.session.postStreamGapCount?.(
									previousRootPostNumber,
									postNumber,
								),
							},
						);
					const topicPresentationChanges =
						new Signal<TopicSessionCommit>();
						const topicPostCommands = new PostActionFeatureCommands(
							bundle.services.postActions,
						);
						const topicPoll = new ReaderTopicPollFeature<TPost>({
							document: options.document,
							actions: bundle.services.actions,
							commands: topicPostCommands,
							descriptors: actionDescriptors,
							readPost: (postId) =>
								bundle.services.session.postById(postId),
							viewer: () => readerPollViewer(
								nativePostModels.currentUser(),
								currentUsername,
							),
							topicArchived: () => {
								const topic = bundle.services.session.topic as
									| Readonly<Record<string, unknown>>
									| null;
								return topic?.archived === true;
							},
							emojiSource: (id) =>
								discourseNativeEmojiUrl(options.host, id),
							notify: (message) => this.feedback.show(message),
							parentScope: context.scope,
							onError: (cause) => reportTopicFeature(
								context.topicId,
								'poll',
								cause,
							),
						});
						const topicBookmarkActions =
						new ReaderBookmarkActionCoordinator<TTopic, TPost>({
							topicId: context.topicId,
							session: bundle.services.session,
							actions: bundle.services.actions,
							postCommands: topicPostCommands,
							descriptors: actionDescriptors,
							forms: nativeBookmarkForm,
							models: nativePostModels,
						});
					const topicShareActions = options.share
						? new ReaderShareActionCoordinator<TTopic, TPost>({
							topicId: context.topicId,
							topic: () => {
								const topic = bundle.services.session.topic;
								if (!topic) {
									throw new Error(
										'分享链接时 canonical Topic 尚未就绪',
									);
								}
								return topic;
							},
							links: nativeTopicLinks,
							surface: options.share,
							fallbackTitle: () =>
								options.document.title || 'LINUX DO',
						})
						: null;
					const topicNotificationActions =
						new ReaderTopicNotificationCoordinator<TTopic, TPost>({
							topicId: context.topicId,
							session: bundle.services.session,
							actions: bundle.services.actions,
							descriptors: actionDescriptors,
							models: nativePostModels,
						});
					const topicSharedIssueActions =
						new ReaderTopicSharedIssueCoordinator<TTopic, TPost>({
							topicId: context.topicId,
							session: bundle.services.session,
							actions: bundle.services.actions,
							descriptors: actionDescriptors,
							settings: nativePostModels,
							currentUsername,
						});
					const assignmentAbort = context.scope.abortController(
						new Error('Reader Topic 指定表单生命周期已结束'),
					);
					const topicManagementActions =
						new ReaderPostManagementActionCoordinator<TTopic, TPost>({
							topicId: context.topicId,
							session: bundle.services.session,
							actions: bundle.services.actions,
							postCommands: topicPostCommands,
							descriptors: actionDescriptors,
							models: nativePostModels,
							composer: this.composer,
							assignments: this.assignmentForm,
							assignmentSignal: assignmentAbort.signal,
							feedback: this.feedback,
							adminMenu: nativeAdminMenu,
							onError: (cause) => reportTopicFeature(
								context.topicId,
								'post-action',
								cause,
							),
						});
					const topicPostActions =
						new ReaderPostActionFeature<TTopic, TPost>({
							document: options.document,
							...(options.renderIcon
								? { renderIcon: options.renderIcon }
								: {}),
							surfaceHost: this.shell.view.surfaceHost,
							topic: () => {
								const topic = bundle.services.session.topic;
								if (!topic) {
									throw new Error(
										'楼层动作渲染时 canonical Topic 尚未就绪',
									);
								}
								return topic;
							},
							actions: bundle.services.actions,
							commands: topicPostCommands,
							descriptors: actionDescriptors,
							models: nativePostModels,
							reactions: postReactions,
							capabilityInput: (post) => {
								const topic =
									bundle.services.session.topic as
										| Readonly<Record<string, unknown>>
										| null;
								const currentUser =
									nativePostModels.currentUser() as
										| Readonly<Record<string, unknown>>
										| null;
								return Object.freeze({
									post,
									...(topic ? { topic } : {}),
									...(currentUser
										? { currentUser }
										: {}),
								currentUsername:
									discourseNativeCurrentUsername(
										options.host,
									),
								plugins: Object.freeze({
									boosts: discourseNativeBoostsAvailable(
										options.host,
									) || Object.hasOwn(post, 'can_boost') ||
										Array.isArray(post.boosts),
								}),
								});
							},
							topicActionRail: Boolean(options.topicActionRail),
							refreshMissingCapabilities: async (post) => {
							const postNumber = tryDiscoursePostNumber(
								post.post_number,
							);
							if (postNumber === null) return;
							await bundle.services.session.loadTarget(postNumber, {
								scope: 'around',
								forceRefresh: true,
								advanceCursor: false,
							});
						},
							presentation: nativeTopicPresentation,
							currentUsername,
							...(options.boostCopy
								? {
									readBoostCopySettings:
										options.boostCopy.readSettings,
								}
								: {}),
							emojiMenu: nativeEmojiMenu,
							confirmBoostDelete: ({ username }) =>
								this.feedback.confirm({
									title: '删除 Boost',
									message: username
										? `确认删除 @${username} 的这条 Boost？`
										: '确认删除这条 Boost？',
									note: '该操作会同步到 Discourse。',
									confirmLabel: '删除',
									tone: 'danger',
								}),
							reportBoost: async ({
								postId,
								boostId,
								username,
							}) => {
								const access =
									await bundle.services.boostReportAccess.load(
										boostId,
									);
								if (!access.canFlag) {
									throw new Error(
										access.alreadyFlagged
											? '你已经举报过这个 Boost'
											: '当前账号不能举报这个 Boost',
									);
								}
								const available = new Set(
									access.availableFlagNames,
								);
								const reportOptions = readerReportOptions(
									options.document,
									nativeFlagCatalog.flagTypes(),
									available,
									'DiscourseBoosts::Boost',
								);
								const reportedUsername =
									access.username || username;
								return this.reportForm.open({
									title: '举报 Boost',
									intro: reportedUsername
										? `举报 @${reportedUsername} 的 Boost 会直接提交给社区，不会离开阅读器。`
										: '举报会直接提交给社区，不会离开阅读器。',
									options: reportOptions,
									messageMaxLength:
										nativeFlagCatalog.messageMaxLength(),
									submit: async ({
										optionId,
										message,
									}) => {
										await bundle.services.actions.dispatch(
											topicPostCommands.boostReport(
												postId,
												actionDescriptors.boostReport({
													boostId,
													flagTypeId: optionId,
													...(message
														? { message }
														: {}),
												}),
											),
										);
										return '举报已提交';
									},
								});
							},
							reportPost: async (post) => {
								const topic =
									bundle.services.session.topic;
								if (!topic) {
									throw new Error(
										'楼层举报时 canonical Topic 尚未就绪',
									);
								}
								const flagTypes =
									nativeFlagCatalog.flagTypes();
								const native =
									nativePostModels.reportContext(
										topic,
										post,
										flagTypes.map((flag) =>
											flag.nameKey),
									);
								const actionByName = new Map(
									native.actions.map((entry) => [
										entry.nameKey,
										entry.action,
									]),
								);
								const reportOptions = readerReportOptions(
									options.document,
									flagTypes,
									new Set(actionByName.keys()),
									'Post',
								);
								const flagById = new Map(
									flagTypes.map((flag) => [
										flag.id,
										flag,
									]),
								);
								const postId = Number(post.id);
								const postNumber =
									Number(post.post_number);
								const topicStarter = postNumber === 1;
								return this.reportForm.open({
									title: topicStarter
										? '举报主题'
										: '举报楼层',
									intro: topicStarter
										? '举报主题会直接提交给社区，不会离开阅读器。'
										: postNumber > 0
										? `举报 #${postNumber} 楼会直接提交给社区，不会离开阅读器。`
										: '举报会直接提交给社区，不会离开阅读器。',
									options: reportOptions,
									messageMaxLength:
										nativeFlagCatalog.messageMaxLength(),
									submit: async ({
										optionId,
										message,
									}) => {
										const flag = flagById.get(optionId);
										const postAction = flag
											? actionByName.get(flag.nameKey)
											: null;
										if (!flag || !postAction) {
											throw new Error(
												'当前举报类型已不可用，请重新打开表单',
											);
										}
										await bundle.services.actions.dispatch(
											topicPostCommands.report(
												postId,
												actionDescriptors.postReport({
													postId,
													post: native.post,
													postAction,
													flagTypeId: optionId,
													...(message
														? { message }
														: {}),
												}),
											),
										);
										return '举报已提交';
									},
								});
							},
							bookmarks: topicBookmarkActions,
							...(topicShareActions
								? { shares: topicShareActions }
								: {}),
							topicNotifications:
								topicNotificationActions,
							sharedIssue: topicSharedIssueActions,
							management: topicManagementActions,
							notify: (message) =>
								this.feedback.show(message),
							composer: this.composer,
							parentScope: context.scope,
							onError: (cause) => reportTopicFeature(
								context.topicId,
								'post-action',
								cause,
							),
						});
					let topicActionRail: ReaderTopicActionRail<TPost> | null = null;
					const topicSummaryImagePicker = this.imageResources
						? new ReaderLightboxImagePicker({
							document: options.document,
							mount: this.shell.view.surfaceHost,
							catalog: topicImages,
							originalSources: this.imageResources,
							maximumSelected: 6,
							notify: (message) => this.feedback.show(message),
							parentScope: context.scope,
							onError: (cause) => reportTopicFeature(
								context.topicId,
								'image-index',
								cause,
							),
						})
						: null;
					const topicSummaryPreview = options.lightbox && options.resources
						? { open: null } as {
							open: ((input: ReaderTopicSummaryImagePreview) => void) | null;
						}
						: null;
					if (topicSummaryPreview) {
						topicSummaryPreviews.set(context.scope, topicSummaryPreview);
						context.scope.add(() => topicSummaryPreviews.delete(context.scope));
					}
					const topicSummarySurface =
						topicSummaryTransport && options.topicActionRail
							? new ReaderTopicSummarySurface({
								document: options.document,
								mount: this.shell.view.surfaceHost,
								request: new ReaderTopicSummaryRequestAdapter({
									gateway: this.data.gateway,
									transport: topicSummaryTransport,
									authScope: options.topic.authScope,
									topicId: context.topicId,
									signal: context.signal,
									...(options.topic.basePath === undefined
										? {}
										: { basePath: options.topic.basePath }),
								}),
								...(this.translationRequests
									? {
										aiModels: this.translationRequests,
									customRequest:
											new ReaderTopicCustomSummaryRequestAdapter({
												document: options.document,
												baseUrl: topicBaseUrl,
												session: bundle.services.session,
												topology: bundle.services.replies.topology,
												completion: this.translationRequests,
												signal: context.signal,
											}),
									}
									: {}),
								...(topicSummaryImagePicker && this.imageResources
									? {
										imagePicker: topicSummaryImagePicker,
										imageResources: this.imageResources,
									}
									: {}),
								uploader: new ReaderTopicSummaryImageUploadAdapter({
									gateway: this.data.gateway,
									transport: topicSummaryTransport,
									authScope: options.topic.authScope,
									topicId: context.topicId,
									signal: context.signal,
									createFormData: () => {
										const Constructor = options.document.defaultView
											?.FormData ?? FormData;
										return new Constructor();
									},
									...(options.topic.basePath === undefined
										? {}
										: { basePath: options.topic.basePath }),
								}),
								topicTitle: () => {
									const topic = bundle.services.session.topic as
										| Readonly<{ readonly title?: unknown }>
										| null;
									return String(
										topic?.title ?? options.document.title ?? '',
									);
								},
								topicUrl: () =>
									nativeTopicLinks.topicHref(context.topicId),
								openReply: async (raw) => {
									const topic = bundle.services.session.topic;
									const firstPost = bundle.services.session.postByNumber(1);
									if (!topic || !firstPost) {
										throw new Error('当前主题 #1 楼尚未就绪');
									}
									await this.composer.openReply({
										topic,
										post: firstPost,
										initialRaw: raw,
									});
								},
								...(options.share
									? { clipboard: options.share }
									: {}),
								...(this.blobDownloads
									? { downloads: this.blobDownloads }
									: {}),
								settingsStorage: options.storage,
								positionMode: () =>
									this.shell.view.root.dataset.readerWorkspaceMode ??
									'floating',
								...(options.topicSummaryFonts
									? { fonts: options.topicSummaryFonts }
									: {}),
								...(topicSummaryPreview
									? {
										previewImage: (input: ReaderTopicSummaryImagePreview) => {
											if (!topicSummaryPreview.open) {
												throw new Error('主题灯箱尚未完成装配');
											}
											topicSummaryPreview.open(input);
										},
									}
									: {}),
								notify: (message) => this.feedback.show(message),
								parentScope: context.scope,
								onError: (cause) => reportTopicFeature(
									context.topicId,
									'post-action',
									cause,
								),
							})
							: null;
					if (topicSummarySurface) {
						this.#topicSummarySurfaces.add(topicSummarySurface);
						context.scope.add(() => {
							this.#topicSummarySurfaces.delete(topicSummarySurface);
						});
					}
					topicActionRail = options.topicActionRail
						? new ReaderTopicActionRail<TPost>({
							document: options.document,
							mount: this.shell.view.modal,
							shellRoot: this.shell.view.root,
							identity: domOptions.identity,
							actions: topicPostActions,
							preferences: options.topicActionRail,
							jumpToTop: async () => {
								const timeline = topicTimelines.get(context.scope);
								if (!timeline) {
									throw new Error(
										'主帖操作列跳转时 Topic timeline 尚未就绪',
									);
								}
								const result = await timeline.jumpTo(1, {
									alignment: 'start',
									highlight: true,
								});
								if (result.status !== 'revealed') {
									throw new Error(
										`主帖操作列回顶失败：${result.status}`,
									);
								}
							},
							...(topicSummarySurface
								? { openTopicSummary: () => topicSummarySurface.open() }
								: {}),
							...(options.downloadCurrentTopic
								? { downloadCurrentTopic: options.downloadCurrentTopic }
								: {}),
							openChronicle: () => this.chronicleView.open(),
							openUnwantedTopics: () => this.unwantedTopicView.open(),
							openUserObservations: () =>
								this.userObservationView.openList(),
							parentScope: context.scope,
							onError: (cause) => reportTopicFeature(
								context.topicId,
								'post-action',
								cause,
							),
						})
						: null;
					if (topicActionRail) {
						bindReaderTopicActionRailStarter({
							readStarter: () =>
								bundle.services.session.postByNumber(1),
							loadStarter: () =>
								bundle.services.session.loadTarget(1, {
									scope: 'single',
									advanceCursor: false,
								}),
							waitUntilReady: () =>
								bundle.services.session.init(),
							subscribe: (listener, scope) =>
								bundle.services.session.changes.subscribe(
									listener,
									scope,
								),
							update: (starter) => topicActionRail.update(starter),
							parentScope: context.scope,
							onError: (cause) => reportTopicFeature(
								context.topicId,
								'post-action',
								cause,
							),
						});
					}
					const topicSpecialContent =
						new ReaderTopicSpecialContentFeature<TTopic, TPost>({
							document: options.document,
							session: bundle.services.session,
							presentationChanges: topicPresentationChanges,
							presentation: nativeTopicPresentation,
							relativeTime: nativeRelativeTime,
							actions: bundle.services.actions,
							commands: topicPostCommands,
							descriptors: actionDescriptors,
							models: nativePostModels,
							loadPostVotingComments: (
								postId,
								afterCommentId,
							) => bundle.services.requests
								.loadPostVotingComments(postId, {
									afterCommentId,
									refresh: true,
								}),
							...(options.renderIcon
								? { renderIcon: options.renderIcon }
								: {}),
								navigate: async (postNumber) => {
								const navigation = topicNavigations.get(
									context.scope,
								);
								if (!navigation) {
									throw new Error(
										'特殊正文跳转时 Topic navigation 尚未就绪',
									);
								}
								const result = await navigation.navigate({
									postNumber,
									source: 'solved-answer',
									alignment: 'center',
									highlight: true,
								});
								if (result.status !== 'revealed') {
									throw new Error(
										`特殊正文楼层 #${postNumber} 跳转失败：${result.status}`,
									);
									}
								},
							onBodyLayerChanged: (view) => {
								topicCookedContent.refresh(view);
								topicMedia.refresh(view);
									this.translationFeature?.syncPost(
										view.slots.root,
									);
								notifyTopicLayoutChanged();
								},
								parentScope: context.scope,
							onError: (cause) => reportTopicFeature(
								context.topicId,
								'special-content',
								cause,
							),
						});
					const topicContext =
						new ReaderTopicContextController<TPost>({
							session: bundle.services.session,
							replies: bundle.replies,
							loadCrossTopicQuotedPost: async (
								targetTopicId,
								targetPostNumber,
							) => {
								const targetOptions = { scope: 'single' as const };
								let lastError: unknown;
								for (const candidate of bundle.services.requests
									.targetCandidates(
										targetPostNumber,
										targetOptions,
										targetTopicId,
									)) {
									try {
										const payload = await bundle.services.requests
											.loadTargetCandidate<unknown>(
												candidate,
												targetPostNumber,
												targetOptions,
												targetTopicId,
											);
										const post = discoursePostsFromPayload<TPost>(payload)
											.find((value) =>
												Number(value.post_number) === targetPostNumber);
										if (post) return post;
									} catch (error) {
										lastError = error;
										const status = Number(
											(error as { readonly status?: unknown })?.status,
										);
											if (
												error instanceof DOMException &&
												error.name === 'AbortError'
											) throw error;
											if (discourseNativeTargetFailureIsDefinitive({
												endpoint: candidate.endpoint,
												scope: targetOptions.scope,
												status,
											})) return null;
											if ([401, 403, 429].includes(status)) throw error;
									}
								}
								if (lastError) throw lastError;
								return null;
							},
							parentScope: context.scope,
							onError: (cause) => reportTopicFeature(
								context.topicId,
								'thread-context',
								cause,
							),
						});
					const topicScroll = new ReaderTopicScrollAdapter({
						...options.navigation,
						scrollRoot: this.shell.view.body,
						viewportChangeTarget: this.shell.view.root,
						parentScope: context.scope,
					});
					const topicContextFeature =
						new ReaderTopicContextFeature<TPost>({
							document: options.document,
							...(options.renderIcon
								? { renderIcon: options.renderIcon }
								: {}),
							controller: topicContext,
							replies: bundle.replies,
							presentationChanges: topicPresentationChanges,
							presentation: replyTreePresentation,
							avatarSource: (template, size) =>
								nativeTopicPresentation.avatarSource(template, size),
							scrollRoot: this.shell.view.body,
							quoteHintHost: this.shell.view.surfaceHost,
							notify: (message) => this.feedback.show(message),
							navigate: () =>
								topicNavigations.get(context.scope) ?? null,
							target: {
								open: async (request) => {
									await this.openTarget(request);
								},
							},
							onQuoteBodyChanged: (view) => {
								topicMedia.refresh(view);
								this.translationFeature?.syncPost(
									view.slots.root,
								);
							},
							onRevealNextReplyLevel: (postNumber) =>
								topicDoms.get(context.scope)
									?.revealNextReplyLevel(postNumber) ?? false,
							revealQuoteTarget: (target, mode) => {
								if (typeof target.getBoundingClientRect !== 'function') return;
								topicScroll.alignPost(target, {
									source: mode === 'match' ? 'quote-match' : 'quote',
									alignment: mode === 'match' ? 'nearest' : 'start',
									highlight: mode === 'floor',
								});
							},
							parentScope: context.scope,
							onError: (cause) => reportTopicFeature(
								context.topicId,
								'thread-context',
								cause,
							),
						});
						const topicCommentsHeader =
						new ReaderTopicCommentsHeader<TTopic, TPost>({
							document: options.document,
							topicId: context.topicId,
							session: bundle.services.session,
							presence: nativePresence,
							presentation: nativeTopicPresentation,
							currentUsername,
							...(options.renderIcon
								? { renderIcon: options.renderIcon }
								: {}),
							parentScope: context.scope,
							onError: (cause) => reportTopicFeature(
								context.topicId,
								'topic-header',
								cause,
							),
							});
						const topicLocalArchive =
							new ReaderTopicLocalArchiveFeature<TPost>({
								document: options.document,
								topicRoot: root,
								session: bundle.services.session,
								parentScope: context.scope,
							});
						const postAuthorFilter = options.unwantedTopicFilter
							? new ReaderPostAuthorFilterFeature<TPost>({
								preferences: options.unwantedTopicFilter,
								recordHiddenPostAuthor: (username) => {
									const topic = bundle.services.session.topic;
									this.unwantedTopics.remember({
										topicId: context.topicId,
										title: String(topic?.title ?? '').trim() ||
											`帖子 #${context.topicId}`,
										href: nativeTopicLinks.topicHref(context.topicId),
										categoryId: topic?.category_id,
										source: 'automatic',
										matchedRule: `楼层用户：@${username}`,
										matchedCategory: false,
									});
								},
								parentScope: context.scope,
								onError: (cause) => reportTopicFeature(
									context.topicId,
									'history',
									cause,
								),
							})
							: null;
						context.scope.add(
						bundle.services.snapshots.setPersistenceDelayReader(
							(minimumIdleMs) =>
								topicScroll.remainingUserIdleMs(minimumIdleMs),
						),
					);
					if (domOptions.postFeatures?.some(
						(feature) => feature instanceof ReaderTopicMediaFeature,
					)) {
						throw new Error(
							'ReaderBrowserRuntime 已拥有唯一 ReaderTopicMediaFeature',
						);
					}
					if (domOptions.postFeatures?.some(
						(feature) =>
							feature instanceof ReaderCookedContentFeature,
					)) {
						throw new Error(
							'ReaderBrowserRuntime 已拥有唯一 ReaderCookedContentFeature',
						);
					}
					if (domOptions.postFeatures?.some(
						(feature) =>
							feature instanceof ReaderTopicSpecialContentFeature,
					)) {
						throw new Error(
							'ReaderBrowserRuntime 已拥有唯一 ReaderTopicSpecialContentFeature',
						);
					}
					if (domOptions.postFeatures?.some(
						(feature) =>
							feature instanceof ReaderTopicContextFeature,
					)) {
						throw new Error(
							'ReaderBrowserRuntime 已拥有唯一 ReaderTopicContextFeature',
						);
					}
						if (domOptions.postFeatures?.some(
							(feature) =>
								feature instanceof ReaderPostActionFeature,
					)) {
						throw new Error(
							'ReaderBrowserRuntime 已拥有唯一 ReaderPostActionFeature',
							);
						}
						if (domOptions.postFeatures?.some(
							(feature) => feature instanceof ReaderTopicPollFeature,
						)) {
							throw new Error(
								'ReaderBrowserRuntime 已拥有唯一 ReaderTopicPollFeature',
							);
						}
							const postFeatures = Object.freeze([
								topicLocalArchive,
								...(postAuthorFilter ? [postAuthorFilter] : []),
								topicCookedContent,
							topicPoll,
							topicSpecialContent,
						topicContextFeature,
						topicPostActions,
						topicCommentsHeader,
						...(domOptions.postFeatures ?? []),
						topicMedia,
					]);
					topicFeatures.set(context.scope, Object.freeze({
						topicImages,
						topicMedia,
						topicCookedContent,
						topicSpecialContent,
						topicContext,
						topicContextFeature,
						highlightDiscussionTarget: (target) =>
							topicScroll.highlight.highlight(target),
						topicActionRail,
						topicPostActions,
						presentation: Object.freeze({
							identity: domOptions.identity,
							renderPost: domOptions.render,
							postFeatures,
						}),
					}));
					return Object.freeze({
						...domOptions,
						replyTreePresentation,
						presentationChanges: topicPresentationChanges,
						postFeatures,
						scroll: topicScroll,
						readDirectReplyPrefetchScreens: () =>
							this.#performance.nestedPrefetchScreens,
						readDirectReplyPrefetchIdleMs: () => Math.max(
							120,
							this.#performance.requestMinIntervalMs + 30,
						),
						readDirectReplyPrefetchConcurrency: () => Math.max(
							1,
							Math.min(
								2,
								this.#performance.requestMaxConcurrent - 1,
							),
						),
						...(options.topicFlowScheduler === undefined
							? {}
							: {
								directReplyPrefetchScheduler: {
									schedule: (
										callback: () => void,
										delayMs: number,
									) => options.topicFlowScheduler!.schedule(
										callback,
										'near-window',
										delayMs,
									),
									cancel: (handle: unknown) =>
										options.topicFlowScheduler!.cancel(
											handle as number,
										),
								},
							}),
					});
				},
				createBundle: (context) => this.data.createTopicBundle<TTopic, TPost>(
					context,
					{
						...options.topic,
						pageSize: this.#performance.pageSize,
						host: options.host,
						nativeAjax: this.nativeAjax,
						nativeActions,
						composerEvents: this.composerIsolation,
						...(options.loadingProgress
							? {
								onLoadingSource: (source, counts) => {
									options.loadingProgress!.update({
										topicId: Number(context.topicId),
										phase: source,
										cachedCount: counts.cachedCount,
										missingCount: counts.missingCount,
									});
								},
							}
							: {}),
					},
				),
					onAssembled: (value, context) => {
						topicDoms.set(context.scope, value.dom);
						const features = topicFeatures.get(context.scope);
						if (!features) {
							throw new Error(
								'Topic context surface 装配时 presentation 尚未就绪',
							);
						}
						const translationGeneration =
							this.translationFeature?.activateTopic(context.topicId);
						context.scope.add(() =>
							this.translationFeature?.deactivateTopic(
								context.topicId,
								translationGeneration,
							));
						let translationWindowPostNumbers = new Set<number>();
						const updateTranslationWindow = (): void => {
							const posts = [...translationWindowPostNumbers]
								.map((postNumber) =>
									value.services.session.postByNumber(postNumber))
								.filter((post): post is TPost => post !== undefined);
							this.translationFeature?.updatePreloadWindow(
								context.topicId,
								posts,
								translationGeneration,
							);
						};
						value.dom.windowChanges.subscribe((commit) => {
							translationWindowPostNumbers = new Set([
								...commit.tree.mountedRoots,
								...commit.tree.mountedReplies,
							]);
							updateTranslationWindow();
							this.translationFeature?.syncMountedPosts();
						}, context.scope);
						value.services.session.changes.subscribe((commit) => {
							this.#rememberChronicleDeletedPosts(
								value,
								commit.changedPostNumbers,
								commit.observedAt,
							);
							let changedWindow = false;
							for (const postNumber of commit.changedPostNumbers) {
								const post = value.services.session.postByNumber(postNumber);
								const parentPostNumber = tryDiscoursePostNumber(
									post?.reply_to_post_number,
								);
								if (
									!translationWindowPostNumbers.has(postNumber) &&
									(parentPostNumber === null ||
										!translationWindowPostNumbers.has(parentPostNumber))
								) continue;
								translationWindowPostNumbers.add(postNumber);
								changedWindow = true;
							}
							if (changedWindow) updateTranslationWindow();
						}, context.scope);
						value.services.live.changes.subscribe((change) => {
							if (change.kind !== 'deleted') return;
							this.#rememberChronicleDeletedPost(
								value,
								change.postNumber,
								Date.now(),
								'message-bus:deleted',
								false,
							);
						}, context.scope);
						value.services.session.archiveChanges.subscribe(() => {
							const active = this.shell.activeValue;
							if (active?.services.session !== value.services.session) return;
							this.#rememberHistoryTopicMetadata(active);
							/*
							 * 红色本地存档标记是持久 canonical 事实，不能依赖刷新后已经
							 * 消失的短命 RequestObservation 才进入岁月史书。
							 */
							this.#rememberChronicleArchives(active);
							/*
							 * 请求观察器会先于 TopicSession 提交缓存存档状态；在正文
							 * 已确认可保留后重放尚未归档的失效请求，保留真实请求诊断。
							 */
							this.#collectChronicleRequests(this.data.requests.snapshot);
						}, context.scope);
						/* 装配时回填刷新前已持久化、但从未进入史书的本地失效状态。 */
						this.#rememberChronicleArchives(value);
						this.#rememberChronicleDeletedPosts(value);
						this.#collectChronicleRequests(
							this.data.requests.snapshot,
							value,
						);
						let contextSurface: ReaderTopicContextSurface<TPost> | null = null;
						const navigation = new ReaderTopicNavigationController<TPost>({
							session: value.services.session,
							dom: value.dom,
							hidden: {
								isHidden: (postNumber) =>
									value.dom.isPostHidden(postNumber),
								async revealPost(postNumber) {
									const surface = contextSurface;
									return surface
										? surface.revealDiscussionPost(postNumber)
										: null;
								},
							},
							listenUserScrollIntent: (listener) =>
								value.dom.listenUserScrollIntent(listener),
						parentScope: context.scope,
						onError: (cause) => reportTopicFeature(
							context.topicId,
							'navigation',
							cause,
						),
						});
						topicNavigations.set(context.scope, navigation);
						const topicFlow = new ReaderTopicFlowController({
								dom: value.dom,
								readPerformance: () => this.#performance,
								sessionChanges:
									value.services.session.changes,
								readLoadDone: () =>
									value.services.session.loadDone,
								...(options.topicFlowScheduler === undefined
									? {}
									: {
										scheduler:
											options.topicFlowScheduler,
									}),
								parentScope: context.scope,
								onError: (cause) => reportTopicFeature(
									context.topicId,
									'navigation',
									cause,
								),
							});
						topicFlows.set(context.scope, topicFlow);
						contextSurface =
							new ReaderTopicContextSurface<TPost>({
								document: options.document,
									controller: features.topicContext,
									replies: value.replies,
									discussionHost: this.shell.view.modal,
									workspace: this.workspace.workspace,
									identity: features.presentation.identity,
								renderPost: features.presentation.renderPost,
								postFeatures: features.presentation.postFeatures,
								postProjector: value.dom.postProjector,
								readDiscussionMaterializedPostLimit: () =>
									Math.max(
										12,
										Math.floor(
											this.#performance
												.streamMaxMountedPostCount / 2,
										),
									),
									highlight:
										features.highlightDiscussionTarget,
									stateRepository: this.threadContextState,
									parentScope: context.scope,
								onError: (cause) => reportTopicFeature(
									context.topicId,
									'thread-context',
									cause,
								),
							});
						topicContextSurfaces.set(context.scope, contextSurface);
						features.topicContextFeature.connectQuoteSource({
							captureAnchor: () => {
								const viewport =
									value.dom.captureViewportAnchor();
								if (!viewport) return null;
								return Object.freeze({
									viewport: Object.freeze({
										...viewport,
										postNumber: discoursePostNumber(
											viewport.postNumber,
										),
									}),
									replyWindow:
										contextSurface.captureDiscussionState(),
									quoteHighlight: null,
								});
							},
							restore: async (source) => {
								return this.#restoreQuoteSource(source);
							},
						});
						this.translationFeature?.syncMountedPosts();
						const header = new ReaderTopicHeaderController<TTopic, TPost>({
						session: value.services.session,
						presentation: nativeTopicPresentation,
						parentScope: context.scope,
						onError: (cause) => {
							reportTopicFeature(
								context.topicId,
								'topic-header',
								cause,
							);
							this.feedback.show(
								cause instanceof Error
									? cause.message
									: '打开帖子编辑器失败',
							);
						},
					});
					topicHeaders.set(context.scope, header);
					const onlyOp =
						new ReaderTopicOnlyOpController<TPost>({
							session: value.services.session,
							presentationChanges:
								value.dom.presentationChanges,
							presentation:
								value.dom.replyTreePresentation,
							onProjectionChanged: (resetScroll) => {
								value.dom.refreshRootProjection(resetScroll);
							},
							onEnabledChanged: (enabled) => {
								topicFlow.setProjectionPriority(enabled);
							},
							parentScope: context.scope,
							onError: (cause) => reportTopicFeature(
								context.topicId,
								'navigation',
								cause,
							),
						});
						topicOnlyOpControllers.set(context.scope, onlyOp);
						const topicVoteSession = value.services.session as unknown as
							TopicActionSessionPort<
								TTopic & Readonly<Record<string, unknown>>
							>;
						const topicVoteCommands = new TopicActionFeatureCommands({
							topicId: context.topicId,
							session: topicVoteSession,
						});
						const headerView = new ReaderTopicHeaderView({
						controller: header,
						hostDocument: options.document,
						elements: readerTopicHeaderElements(
							this.shell.view.root,
						),
						onlyOp,
						...(options.renderIcon
							? { renderIcon: options.renderIcon }
							: {}),
						onJumpFirst: async () => {
							const result = await navigation.navigate({
								postNumber: 1,
								source: 'link',
								alignment: 'start',
								highlight: true,
							});
							if (result.status !== 'revealed') {
								throw new Error(
									`主题标题跳转失败：${result.status}`,
								);
							}
						},
							onToggleTopicVote: async (voted) => {
								if (!discourseNativeCurrentUsername(options.host)) {
								throw new Error('登录后才能为主题投票。');
							}
								await value.services.actions.dispatch(topicVoteCommands.vote(
								voted,
								actionDescriptors.topicVoteToggle({
									topicId: context.topicId,
									voted,
								}),
							));
						},
						parentScope: context.scope,
						onError: (cause) => reportTopicFeature(
							context.topicId,
							'topic-header',
							cause,
						),
					});
					topicHeaderViews.set(context.scope, headerView);
					const topicEditTrigger =
						this.shell.view.root.querySelector<HTMLButtonElement>(
							'.ldp-topic-edit-trigger',
						);
					if (!topicEditTrigger) {
						throw new Error('Reader Header 缺少 Topic 编辑入口');
					}
					new ReaderTopicEditController<TTopic, TPost>({
						topicId: context.topicId,
						session: value.services.session,
						trigger: topicEditTrigger,
						form: this.topicEditForm,
						catalog: nativeTopicEditCatalog,
						actions: value.services.actions,
						descriptors: actionDescriptors,
						models: nativePostModels,
						notify: (message) => this.feedback.show(message),
						parentScope: context.scope,
						onError: (cause) => reportTopicFeature(
							context.topicId,
							'topic-header',
							cause,
						),
					});
					const readTotalPostCount = (): number => {
						const topic =
							value.services.session.topic ?? value.topic;
						const candidates = [
							Number(topic.highest_post_number),
							Number(topic.posts_count),
							...value.services.session.cachedPosts().map((post) =>
								tryDiscoursePostNumber(post.post_number) ?? 0),
						];
						return Math.max(
							1,
							...candidates.filter((candidate) =>
								Number.isSafeInteger(candidate) && candidate > 0),
						);
					};
					const timelinePresentation =
						value.dom.replyTreePresentation;
					const timeline = new ReaderTopicTimelineController({
						navigation,
						readTotalPostCount,
						readNavigablePostNumbers: () =>
							timelinePresentation.roots(),
						readNavigablePostNumbersComplete: () =>
							!timelinePresentation.canonicalFrozen &&
							timelinePresentation.coverageComplete,
						parentScope: context.scope,
						onError: (cause) => reportTopicFeature(
							context.topicId,
							'navigation',
							cause,
						),
					});
					topicTimelines.set(context.scope, timeline);
					const timelineViewOptions = options.timelineView;
					if (timelineViewOptions) {
						const {
							readPreferences,
							preferences,
							formatRelative,
							notify,
							...viewOptions
						} = timelineViewOptions;
						const timestamp = (value: unknown): string | null =>
							typeof value === 'string' && value.trim()
								? value
								: null;
						const currentTopic = (): TTopic =>
							value.services.session.topic ?? value.topic;
						const timelineView = new ReaderTopicTimelineView({
							...viewOptions,
							controller: timeline,
							elements: readerTopicTimelineElements(
								this.shell.view.root,
							),
							preferences:
								readPreferences?.() ?? preferences,
							readCreatedAt: (postNumber) => {
								const post =
									value.services.session.postByNumber(postNumber);
								return timestamp(post?.created_at) ??
									(postNumber === 1
										? timestamp(currentTopic().created_at)
										: null);
							},
							readLatestReplyAt: () =>
								timestamp(currentTopic().last_posted_at),
							formatRelative:
								formatRelative ?? nativeRelativeTime,
							notify:
								notify ??
								((message) => this.feedback.show(message)),
							parentScope: context.scope,
							onError: (cause) => reportTopicFeature(
								context.topicId,
								'navigation',
								cause,
							),
						});
						topicTimelineViews.set(context.scope, timelineView);
					}
					const liveNavigation =
						new ReaderTopicLiveNavigationController<TTopic, TPost>({
							live: value.services.live,
							navigation,
							parentScope: context.scope,
							onError: (cause) => reportTopicFeature(
								context.topicId,
								'navigation',
								cause,
							),
						});
					topicLiveNavigations.set(context.scope, liveNavigation);
					topicLiveNavigationViews.set(
						context.scope,
						new ReaderTopicLiveNavigationView({
							navigation: liveNavigation,
							elements: readerTopicLiveNavigationElements(
								this.shell.view.root,
							),
							notify: (message) => this.feedback.show(message),
							parentScope: context.scope,
						}),
					);
					value.dom.visibleRootChanges.subscribe((change) => {
						const visibleRootPostNumber =
							timelinePresentation.rootOf(change.postNumber) ??
							change.postNumber;
						timeline.syncVisiblePost(visibleRootPostNumber, change);
						liveNavigation.syncViewport(change);
					}, context.scope);
					value.services.session.changes.subscribe(() => {
						timeline.refresh();
						topicTimelineViews.get(context.scope)?.refresh();
					}, context.scope);
					value.services.composerEvents.changes.subscribe((commit) => {
						if (commit.postNumber === null) return;
						void navigation.navigate({
							postNumber: commit.postNumber,
							source: 'composer',
							alignment: 'nearest',
							focus: true,
							highlight: true,
						}).catch(() => {
							// navigation owner 已发送具名诊断。
						});
					}, context.scope);
				},
			});
			this.topicFactory = async (context) => {
				const result = await coreTopicFactory(context);
				const openNative =
					this.shell.view.root.querySelector<HTMLAnchorElement>(
						'.ldp-open',
					);
				if (!openNative) {
					throw new Error('Reader Shell 缺少原生主题入口');
				}
				const nativeHref = readerNativeTopicHref(
					nativeTopicLinks.topicHref(context.topicId),
					topicBaseUrl,
				);
				openNative.href = nativeHref;
				openNative.hidden = !nativeHref;
				context.scope.add(() => {
					if (openNative.href !== nativeHref) return;
					openNative.removeAttribute('href');
					openNative.hidden = true;
				});
				const features = topicFeatures.get(context.scope);
				if (!features) throw new Error('Topic presentation features 未完成装配');
				const topicHeader = topicHeaders.get(context.scope);
				if (!topicHeader) throw new Error('Topic header 未完成装配');
				const topicHeaderView = topicHeaderViews.get(context.scope);
				if (!topicHeaderView) throw new Error('Topic header View 未完成装配');
				const topicOnlyOp = topicOnlyOpControllers.get(context.scope);
				if (!topicOnlyOp) throw new Error('只看楼主控制器未完成装配');
					const topicNavigation = topicNavigations.get(context.scope);
					if (!topicNavigation) throw new Error('Topic navigation 未完成装配');
					const topicFlow = topicFlows.get(context.scope);
					if (!topicFlow) throw new Error('Topic flow 未完成装配');
					const topicContextSurface =
						topicContextSurfaces.get(context.scope);
					if (!topicContextSurface) {
						throw new Error('Topic context surface 未完成装配');
					}
				const topicTimeline = topicTimelines.get(context.scope);
				if (!topicTimeline) throw new Error('Topic timeline 未完成装配');
				const topicTimelineView =
					topicTimelineViews.get(context.scope) ?? null;
				const topicLiveNavigation =
					topicLiveNavigations.get(context.scope);
				if (!topicLiveNavigation) {
					throw new Error('Topic live navigation 未完成装配');
				}
				const topicLiveNavigationView =
					topicLiveNavigationViews.get(context.scope);
				if (!topicLiveNavigationView) {
					throw new Error('Topic live navigation View 未完成装配');
				}
				let value: ReaderBrowserTopicContext<TTopic, TPost> | null = null;
				const lightboxOptions = options.lightbox;
				const lightboxPostCommands = new PostActionFeatureCommands(
					result.value.services.postActions,
				);
				const topicLightbox = lightboxOptions
					? new ReaderLightboxFeature<TTopic, TPost>({
						document: options.document,
						mount: typeof lightboxOptions.mount === 'function'
							? lightboxOptions.mount()
							: lightboxOptions.mount,
						topic: () =>
							result.value.services.session.topic ?? result.value.topic,
						session: result.value.services.session,
						replies: result.value.replies,
						composer: this.composer,
						identity: features.presentation.identity,
						renderPost: features.presentation.renderPost,
						postFeatures: features.presentation.postFeatures,
						reactionSurfaces: features.topicPostActions,
						postProjector: result.value.dom.postProjector,
						minimumCommentLength: () =>
							nativePostModels.minimumPostLength(),
						submitComment: async ({ topic, targetPost, raw }) => {
							await this.composer.openReply({
								topic,
								post: targetPost,
								initialRaw: raw,
								replaceRaw: true,
							});
							return result.value.services.actions.dispatch(
								lightboxPostCommands.reply(
									actionDescriptors.replyCreate<TPost>({
										postId: Number(targetPost.id),
										replyToPostNumber: Number(
											targetPost.post_number,
										),
									}),
								),
							);
						},
						topicImages: features.topicImages,
						...(lightboxOptions.originalSources
							? { originalSources: lightboxOptions.originalSources }
							: {}),
						...(this.imageResources
							? { imageResources: this.imageResources }
							: {}),
						...(this.imageDownloads
							? { imageDownloads: this.imageDownloads }
							: {}),
						...(lightboxOptions.confirmOriginalDownload
							? {
								confirmOriginalDownload:
									lightboxOptions.confirmOriginalDownload,
							}
							: {
								confirmOriginalDownload: (missing: number, total: number) =>
									this.feedback.confirm({
										title: total === 1 ? '下载当前图片' : '批量下载图片',
										message: total === 1
											? '当前原图尚未缓存，是否按阅读器限速获取原图？'
											: `${missing} 张原图尚未缓存，是否按阅读器限速逐张获取？`,
										note: '取消将使用每张图片当前最高缓存或预览质量。',
										confirmLabel: '获取原图',
										cancelLabel: '使用预览质量',
										tone: 'primary',
									}),
							}),
						notify: (message) => this.feedback.show(message),
						...(lightboxOptions.originalByDefault === undefined
							? {}
							: {
								originalByDefault:
									lightboxOptions.originalByDefault,
							}),
						...(lightboxOptions.commentsExpandedByDefault === undefined
							? {}
							: {
								commentsExpandedByDefault:
									lightboxOptions.commentsExpandedByDefault,
							}),
						...(lightboxOptions.descriptionExpandedByDefault === undefined
							? {}
							: {
								descriptionExpandedByDefault:
									lightboxOptions.descriptionExpandedByDefault,
							}),
						...(lightboxOptions.readDefaults
							? { readDefaults: lightboxOptions.readDefaults }
							: {}),
						...(lightboxOptions.preferences
							? { preferences: lightboxOptions.preferences }
							: {}),
						...(lightboxOptions.commentsEnabled === undefined
							? {}
							: { commentsEnabled: lightboxOptions.commentsEnabled }),
						...(lightboxOptions.frameScheduler
							? { frameScheduler: lightboxOptions.frameScheduler }
							: {}),
						onJumpToPost: async (item) => {
							if (!value) {
								throw new Error('Topic context 尚未完成装配');
							}
							await value.topicNavigation.navigate({
								postNumber: item.sourcePostNumber,
								source: 'lightbox',
								alignment: 'center',
								highlight: true,
							});
							await lightboxOptions.onJumpToPost?.(item, value);
						},
						onClose: () => {
							if (value) lightboxOptions.onClose?.(value);
						},
						parentScope: context.scope,
						onError: (cause) => {
							try {
								lightboxOptions.onError?.(cause);
							} catch {
								// 领域诊断不得扩大为 Lightbox session 失败。
							}
							reportTopicFeature(
								context.topicId,
								'image-interaction',
								cause,
							);
						},
					})
					: null;
				const topicSummaryPreview = topicSummaryPreviews.get(context.scope);
				const topicSummaryPreviewObjectUrls = options.resources?.objectUrls;
				if (topicLightbox && topicSummaryPreview && topicSummaryPreviewObjectUrls) {
					topicSummaryPreview.open = ({ blob, alt, returnFocus }) => {
						const source = topicSummaryPreviewObjectUrls.createObjectURL(blob);
						try {
							const session = topicLightbox.open({
								items: [Object.freeze({
									key: `topic-summary-share:${context.topicId}:${Date.now()}`,
									topicId: context.topicId,
									sourcePostNumber: 1,
									imageOrder: 0,
									previewSrc: source,
									originalSrc: source,
									alt,
								})],
								initialIndex: 0,
								returnFocus,
								commentsExpanded: false,
								descriptionExpanded: false,
								commentsEnabled: false,
								includeTopicImages: false,
								batchEnabled: false,
							});
							session.view.scope.add(() => {
								topicSummaryPreviewObjectUrls.revokeObjectURL(source);
							});
						} catch (cause) {
							topicSummaryPreviewObjectUrls.revokeObjectURL(source);
							throw cause;
						}
					};
					context.scope.add(() => {
						topicSummaryPreview.open = null;
					});
				}
					const openTopicImage = options.openTopicImage;
				const topicImageInteraction = topicLightbox || openTopicImage
					? new ReaderTopicImageInteraction({
						topicHost: result.value.root,
						additionalHosts: [
							topicContextSurface.discussionContentHost,
						],
						images: features.topicImages,
						open: (request) => {
							if (topicLightbox) {
									topicLightbox.open({
										items: request.items,
										initialIndex: request.initialIndex,
										returnFocus: request.returnFocus,
									...(request.commentsEnabled === undefined
										? {}
										: { commentsEnabled: request.commentsEnabled }),
									...(request.includeTopicImages === undefined
										? {}
										: { includeTopicImages: request.includeTopicImages }),
								});
								return;
							}
							if (!value) throw new Error('Topic context 尚未完成装配');
							return openTopicImage!(request, value);
						},
						currentTopicId: context.topicId,
						loadQuotedPost: (targetTopicId, targetPostNumber) =>
							features.topicContext.loadQuotedPost(
								targetTopicId,
								targetPostNumber,
							),
						parentScope: context.scope,
						onError: (cause) => reportTopicFeature(
							context.topicId,
							'image-interaction',
							cause,
						),
					})
					: null;
				const topicSelectionQuote =
					new ReaderSelectionQuoteFeature<TTopic, TPost>({
						document: options.document,
						root: this.shell.view.surfaceHost,
						contentRoot: this.shell.view.modal,
						topicId: context.topicId,
						topic: () =>
							result.value.services.session.topic ??
							result.value.topic,
						postById: (postId) =>
							result.value.services.session.postById(postId),
						postByNumber: (postNumber) =>
							result.value.services.session.postByNumber(postNumber),
						images: features.topicImages,
						composer: this.composer,
						...(options.share ? { clipboard: options.share } : {}),
						feedback: this.feedback,
						parentScope: context.scope,
						onError: (cause) => reportTopicFeature(
							context.topicId,
							'selection-quote',
							cause,
						),
					});
				value = Object.freeze({
					...result.value,
					topicImages: features.topicImages,
					topicMedia: features.topicMedia,
					topicCookedContent: features.topicCookedContent,
						topicHeader,
						topicHeaderView,
						topicOnlyOp,
						topicSpecialContent: features.topicSpecialContent,
						topicContext: features.topicContext,
						topicContextFeature: features.topicContextFeature,
						topicContextSurface,
						topicLiveNavigation,
					topicLiveNavigationView,
					topicNavigation,
					topicFlow,
					topicSelectionQuote,
					topicActionRail: features.topicActionRail,
					topicTimeline,
					topicTimelineView,
					topicImageInteraction,
					topicLightbox,
				});
				const readyCleanup = topicReady?.(value, context);
				if (typeof readyCleanup === 'function') {
					context.scope.add(readyCleanup);
				}
				return Object.freeze({
					...result,
					value,
					prepareClose: async (reason: ReaderTopicCloseReason) => {
						await result.prepareClose?.(reason);
						this.#rememberHistoryTopicMetadata(value!);
					},
				});
			};
			this.history = new ReaderHistoryRepository({
				storage: options.storage,
				authScope: options.topic.authScope,
				...(options.history?.key === undefined
					? {}
					: { key: options.history.key }),
				...(options.history?.maxAgeMs === undefined
					? {}
					: { maxAgeMs: options.history.maxAgeMs }),
				...(options.history?.now === undefined
					? {}
					: { now: options.history.now }),
				});
				this.history.load();
				this.data.requests.changes.subscribe(
					(snapshot) => this.#collectChronicleRequests(snapshot),
					this.scope,
				);
				this.#collectChronicleRequests(this.data.requests.snapshot);
				this.history.changes.subscribe(() => {
				this.notificationPanelView?.syncArchiveMarkers();
				this.bookmarkPanelView?.syncArchiveMarkers();
			}, this.scope);
			this.historyNavigation = new ReaderHistoryNavigationController({
				history: this.history,
				readSortMode:
					options.history?.readSortMode ?? (() => 'recent-viewed'),
				port: {
					activeTopicId: () => this.shell.activeTopicId,
					captureAnchor: () =>
						this.#captureAndRememberHistoryAnchor(),
					openTopic: async (topicId) => {
						const result = await this.shell.open(
							topicId,
							this.topicFactory,
						);
						if (
							result.status === 'opened' ||
							result.status === 'reused'
						) {
							this.#rememberHistoryTopicMetadata(result.value);
						}
						return this.#historyOpenResult(result);
					},
					restoreAnchor: async (topicId, anchor, restoreOptions) => {
						const value = this.shell.activeValue;
						if (
							this.shell.activeTopicId !== topicId ||
							value === null
						) {
							throw new Error(
								`历史目标 Topic ${topicId} 未处于 active 状态`,
							);
						}
						const proportional =
							anchor.viewport.scrollRatio !== undefined;
						const restoreSemanticState =
							restoreOptions?.restoreSemanticState !== false;
						if (!proportional && restoreSemanticState) {
							const result = await value.topicNavigation.navigate({
								postNumber: anchor.viewport.postNumber,
								source: 'history',
								alignment: 'nearest',
								highlight: restoreOptions?.highlight !== false,
							});
							if (result.status !== 'revealed') {
								throw new Error(
									`旧历史楼层 #${anchor.viewport.postNumber} ` +
									`恢复失败：${result.status}`,
								);
							}
						}
						const navigationRevision = value.topicNavigation.revision;
						if (restoreSemanticState && anchor.replyWindow) {
							await value.topicContextSurface
								.restoreDiscussionState(anchor.replyWindow);
						} else {
							value.topicContext.closeDiscussion();
						}
						if (!value.topicNavigation.isCurrent(navigationRevision)) return;
						const quoteHighlight = restoreSemanticState
							? anchor.quoteHighlight
							: null;
						if (
							!await value.topicContextFeature
								.restoreQuoteHighlightState(quoteHighlight)
						) {
							throw new Error(
								`历史引用高亮 #${quoteHighlight?.postNumber ?? 0} ` +
								'恢复失败',
							);
						}
						if (
							quoteHighlight === null &&
							!value.topicNavigation.isCurrent(navigationRevision)
						) return;
						/*
						 * 新历史以整个 Reader 主滚动区的高度比例为 owner；这里在结构恢复后
						 * 一次写入换算坐标，不先跳楼层、不楼层高亮。无比例的旧历史不做伪恢复。
						 */
						if (
							(proportional || restoreSemanticState) &&
							!value.dom.restoreViewportAnchor(anchor.viewport)
						) {
							throw new Error('历史 Reader 高度锚点恢复失败');
						}
						if (!proportional && restoreSemanticState) {
							value.topicTimeline.syncVisiblePost(anchor.viewport.postNumber);
						}
						if (proportional) {
							this.#rememberHistoryTopic(
								value,
								anchor.viewport.postNumber,
								anchor.viewport,
							);
						} else {
							this.#rememberHistoryTopicMetadata(value);
						}
					},
				},
				parentScope: this.scope,
				onError: (cause) => reportTopicFeature(
					this.shell.activeTopicId ?? 0,
					'history',
					cause,
				),
			});
			const historyViewOptions = options.history?.navigationView;
			if (historyViewOptions) {
				const root = this.shell.view.root;
				const backEdge = root.querySelector<HTMLElement>(
					'.ldp-reader-history-edge-back',
				);
				const forwardEdge = root.querySelector<HTMLElement>(
					'.ldp-reader-history-edge-forward',
				);
				const backButton = root.querySelector<HTMLButtonElement>(
					'.ldp-reader-history-back',
				);
				const forwardButton = root.querySelector<HTMLButtonElement>(
					'.ldp-reader-history-forward',
				);
				if (
					!backEdge ||
					!forwardEdge ||
					!backButton ||
					!forwardButton
				) {
					throw new Error(
						'历史导航 View 缺少 Shell 命名边缘或按钮',
					);
				}
				this.historyNavigationView =
					new ReaderHistoryNavigationView({
						navigation: this.historyNavigation,
						elements: {
							root,
							modal: this.shell.view.modal,
							backEdge,
							forwardEdge,
							backButton,
							forwardButton,
						},
						preferences: historyViewOptions.preferences,
						window:
							historyViewOptions.window === undefined
								? options.document.defaultView
								: historyViewOptions.window,
						topicTitle: (topicId) =>
							this.history.entry(topicId)?.title ?? null,
						parentScope: this.scope,
						onError: (cause) => reportTopicFeature(
							this.shell.activeTopicId ?? 0,
							'history',
							cause,
						),
					});
			} else {
				this.historyNavigationView = null;
			}
			const historyPanelOptions = options.history?.panelView;
			if (historyPanelOptions) {
				const root = this.shell.view.root;
				const toggle = root.querySelector<HTMLButtonElement>(
					'.ldp-history-toggle',
				);
				const popover = root.querySelector<HTMLElement>(
					'.ldp-history-popover',
				);
				const sortToggle = root.querySelector<HTMLButtonElement>(
					'.ldp-history-sort-toggle',
				);
				const multiButton = root.querySelector<HTMLButtonElement>(
					'.ldp-history-multi',
				);
				const clearButton = root.querySelector<HTMLButtonElement>(
					'.ldp-history-clear',
				);
				const defaultActions = root.querySelector<HTMLElement>(
					'.ldp-history-default-actions',
				);
				const bulkActions = root.querySelector<HTMLElement>(
					'.ldp-history-bulk-actions',
				);
				const selectScope = root.querySelector<HTMLSelectElement>(
					'.ldp-history-select-scope',
				);
				const selectToggle = root.querySelector<HTMLButtonElement>(
					'.ldp-history-select-toggle',
				);
				const deleteSelected = root.querySelector<HTMLButtonElement>(
					'.ldp-history-delete-selected',
				);
				const deleteSelectedLabel = root.querySelector<HTMLElement>(
					'.ldp-history-delete-selected-label',
				);
				const multiDone = root.querySelector<HTMLButtonElement>(
					'.ldp-history-multi-done',
				);
				const search = root.querySelector<HTMLInputElement>(
					'.ldp-history-search',
				);
				const searchClear = root.querySelector<HTMLButtonElement>(
					'.ldp-history-search-clear',
				);
				const categoryFilter = root.querySelector<HTMLSelectElement>(
					'.ldp-history-category-filter',
				);
				const tagFilter = root.querySelector<HTMLSelectElement>(
					'.ldp-history-tag-filter',
				);
				const list = root.querySelector<HTMLElement>(
					'.ldp-history-list',
				);
				const pagePrevious = root.querySelector<HTMLButtonElement>(
					'.ldp-history-page-prev',
				);
				const pageInfo = root.querySelector<HTMLElement>(
					'.ldp-history-page-info',
				);
				const pageNext = root.querySelector<HTMLButtonElement>(
					'.ldp-history-page-next',
				);
				if (
					!toggle ||
					!popover ||
					!sortToggle ||
					!multiButton ||
					!clearButton ||
					!defaultActions ||
					!bulkActions ||
					!selectScope ||
					!selectToggle ||
					!deleteSelected ||
					!deleteSelectedLabel ||
					!multiDone ||
					!search ||
					!searchClear ||
					!categoryFilter ||
					!tagFilter ||
					!list ||
					!pagePrevious ||
					!pageInfo ||
					!pageNext
				) {
					throw new Error(
						'历史列表 View 缺少 Shell 命名面板控件',
					);
				}
				this.historyPanelView = new ReaderHistoryPanelView({
					...historyPanelOptions,
					...((historyPanelOptions.searchForms ??
						options.searchForms) === undefined
						? {}
						: {
							searchForms:
								historyPanelOptions.searchForms ??
								options.searchForms,
						}),
					confirmDelete:
						historyPanelOptions.confirmDelete ??
						((request) => this.feedback.confirm(request)),
					notify:
						historyPanelOptions.notify ??
						((message) => this.feedback.show(message)),
					document: options.document,
					mount: this.shell.view.surfaceHost,
					storage: options.storage,
					history: this.history,
					elements: {
						root,
						toggle,
						popover,
						sortToggle,
						multiButton,
						clearButton,
						defaultActions,
						bulkActions,
						selectScope,
						selectToggle,
						deleteSelected,
						deleteSelectedLabel,
						multiDone,
						search,
						searchClear,
						categoryFilter,
						tagFilter,
						list,
						pagePrevious,
						pageInfo,
						pageNext,
					},
					openEntry: async (entry) => {
						await this.#openHistoryEntry(entry);
					},
					emojiSource: historyPanelOptions.emojiSource ?? ((id) =>
						discourseNativeEmojiUrl(options.host, id)),
					parentScope: this.scope,
					onError: (cause) => reportTopicFeature(
						this.shell.activeTopicId ?? 0,
						'history',
						cause,
					),
				});
			} else {
				this.historyPanelView = null;
			}
			this.shell.changes.subscribe((state) => {
				if (state === 'switching' || state === 'closed') {
					this.#closeApplicationSurfaces();
				}
			}, this.scope);
		} catch (error) {
			this.scope.destroy();
			throw error;
		}
	}

	get performance(): ReaderPerformanceSnapshot {
		return this.#performance;
	}

	reloadExternalTopicSummaryState(): void {
		for (const surface of this.#topicSummarySurfaces) {
			surface.reloadExternalState();
		}
	}

	applyPerformance(snapshot: ReaderPerformanceSnapshot): void {
		if (this.#destroyed || this.scope.destroyed) return;
		this.#performance = snapshot;
		this.#applyPerformanceInfrastructure();
		const active = this.shell.activeValue;
		active?.services.session.applyPageSize(snapshot.pageSize);
		active?.topicFlow.refreshPerformance();
	}

	async open(
		topicId: number,
	): Promise<ReaderShellOpenResult<ReaderBrowserTopicContext<TTopic, TPost>>> {
		return (await this.openTarget({
			topicId,
			source: 'link',
		})).topic;
	}

	async openTarget(
		request: ReaderBrowserTargetRequest,
	): Promise<ReaderBrowserTargetResult<TTopic, TPost>> {
		if (this.#destroyed || this.scope.destroyed) {
			return Object.freeze({
				topic: Object.freeze({
					status: 'failed',
					topicId: discourseTopicId(request.topicId),
					cause: new Error('ReaderBrowserRuntime 已销毁'),
				}),
				navigation: null,
			});
		}
		this.#boostTargetHighlight.clear();
		const normalizedTopicId = discourseTopicId(request.topicId);
		const chronicleRequestFloor =
			this.data.requests.snapshot.events.at(-1)?.id ?? 0;
		this.#openRecoveryController?.abort(
			new DOMException('新的打开事务已开始', 'AbortError'),
		);
		const recoveryController = new AbortController();
		this.#openRecoveryController = recoveryController;
		const transactionIsCurrent = (): boolean =>
			!this.#destroyed &&
			!this.scope.destroyed &&
			!recoveryController.signal.aborted &&
			this.#openRecoveryController === recoveryController;
		const superseded = (): ReaderBrowserTargetResult<TTopic, TPost> =>
			Object.freeze({
				topic: Object.freeze({
					status: 'superseded',
					topicId: normalizedTopicId,
				}),
				navigation: null,
			});
		const releaseLoading = this.#loadingProgress?.begin(
			Number(normalizedTopicId),
			request.postNumber,
		);
		try {
			this.recovery.clear();
			const previousTopicId =
				this.shell.activeTopicId !== null &&
				this.shell.activeTopicId !== normalizedTopicId
					? this.shell.activeTopicId
					: null;
			const previousAnchor = previousTopicId === null
				? null
				: this.historyNavigation.captureCurrent();
			let result: ReaderShellOpenResult<
				ReaderBrowserTopicContext<TTopic, TPost>
			>;
			for (let attempt = 0; ; attempt += 1) {
				result = await this.shell.open(
					normalizedTopicId,
					this.topicFactory,
				);
				if (!transactionIsCurrent()) return superseded();
				if (
					result.status !== 'failed' ||
					!readerShellOpenRetryable(result.cause) ||
					attempt >= 2
				) {
					break;
				}
				this.feedback.show(
					`帖子加载暂时失败，${attempt + 1} 秒后自动重试一次`,
				);
				try {
					await this.#openRetryDelay(
						(attempt + 1) * 1_000,
						recoveryController.signal,
					);
				} catch {
					return superseded();
				}
			}
			if (result.status === 'opened' || result.status === 'reused') {
				this.#lastFailedRequest = null;
				/*
				 * Shell 已打开即属于浏览历史；目标楼层定位和讨论树补载可能很慢，
				 * 不得让搜索入口的历史记录等到后续导航 finally 才出现；此处只更新
				 * Topic 元数据，URL 目标楼层不得覆盖最后切出位置。
				 */
				this.#rememberHistoryTopicMetadata(result.value);
				if (
					this.historyNavigation.snapshot.activeTopicId !== result.topicId
				) {
					this.historyNavigation.activate(result.topicId);
				}
				let navigation: ReaderTopicNavigationResult | null = null;
				try {
					if (request.postNumber !== undefined) {
						if (request.localArchive) {
							await result.value.services.session
								.restoreUnavailablePostFromCache(
								request.postNumber,
								request.localArchive.status,
								request.localArchive.confirmedAt,
								request.localArchive.requestPath,
							);
						}
						for (let attempt = 0; ; attempt += 1) {
							let navigationCause: unknown = null;
							try {
								navigation = await result.value.topicNavigation.navigate({
									postNumber: request.postNumber,
									source: request.source,
									...(request.alignment === undefined
										? {}
										: { alignment: request.alignment }),
									...(request.focus === undefined
										? {}
										: { focus: request.focus }),
									...(request.highlight === undefined
										? {}
										: { highlight: request.highlight }),
									...(request.forceRefresh === undefined
										? {}
										: { forceRefresh: request.forceRefresh }),
									...(request.cachedOnly === undefined
										? {}
										: { cachedOnly: request.cachedOnly }),
									...(request.revealAsFloor === undefined
										? {}
										: { revealAsFloor: request.revealAsFloor }),
								});
							} catch (cause) {
								navigationCause = cause;
							}
							if (!transactionIsCurrent()) return superseded();
							const retryable = navigationCause !== null
								? readerShellOpenRetryable(navigationCause)
								: navigation?.status === 'unresolved-tree';
							if (!retryable || attempt >= 2) {
								if (navigationCause !== null) {
									this.#lastFailedRequest = Object.freeze({ ...request });
									this.feedback.show(
										'帖子已打开，但目标楼层定位失败；当前 Topic 已保留，可稍后再次跳转',
									);
									return Object.freeze({ topic: result, navigation: null });
								} else if (navigation?.status === 'unresolved-tree') {
									this.feedback.show(
										'帖子已打开，但目标楼层的回复树暂未完成挂载；当前 Topic 已保留，可稍后再次跳转',
									);
								}
								break;
							}
							this.feedback.show(
								`目标楼层定位暂时失败，${attempt + 1} 秒后自动重试一次`,
							);
							try {
								await this.#openRetryDelay(
									(attempt + 1) * 1_000,
									recoveryController.signal,
								);
							} catch {
								return superseded();
							}
							}
							if (!transactionIsCurrent()) return superseded();
							if (navigation?.status !== 'revealed') {
								return Object.freeze({ topic: result, navigation });
							}
							const targetPost =
							result.value.services.session.postByNumber(
								request.postNumber,
							);
						const treeParent =
							result.value.replies.topology.parentOf(
								request.postNumber,
							);
						const canonicalParent = treeParent === undefined
							? tryDiscoursePostNumber(
								targetPost?.reply_to_post_number,
							)
							: treeParent;
						if (
							request.revealAsFloor !== true &&
							canonicalParent !== null &&
							canonicalParent !== undefined &&
							canonicalParent > 1 &&
							!navigation.element?.closest(
								'.ldp-descendant-replies-layer',
							)
						) {
							await result.value.topicContext.openDiscussion(
								request.postNumber,
							);
							if (!transactionIsCurrent()) return superseded();
						}
						if (request.quoteHighlight) {
							const quoteMatched = navigation.element
								? result.value.topicContextFeature
									.applyRevealedQuoteHighlight(
										request.quoteHighlight,
										navigation.element,
									)
								: false;
							if (!quoteMatched) {
								this.feedback.show(
									`目的地内容已修改；已定位到楼层 #${request.postNumber}`,
								);
							}
						}
						if (request.highlight !== false && request.boostId !== undefined) {
							this.#highlightBoostTarget(request, navigation.element);
						}
					}
					return Object.freeze({ topic: result, navigation });
				} finally {
					if (transactionIsCurrent()) {
						this.#rememberHistoryTopicMetadata(result.value);
						if (
							this.historyNavigation.snapshot.activeTopicId !==
								result.topicId
						) {
							this.historyNavigation.activate(result.topicId);
						}
					}
				}
			}
			if (result.status === 'failed') {
				if (!transactionIsCurrent()) return superseded();
				this.#lastFailedRequest = Object.freeze({ ...request });
				if (readerShellFailureKind(result.cause) === 'cloudflare') {
					/*
					 * passed 的短租约只负责吸收过盾前已经在途的迟到响应；当前
					 * Topic 是用户新发起且已经终态失败的业务请求，必须强制建立
					 * 新 required 世代，否则 session 探针 200 会把真实 Topic 429
					 * 吞成“已经过盾”，页面却只剩无限加载或保留旧帖。
					 */
					await this.permit.noteCloudflareChallenge({
						href: this.#challengeHref,
						force: true,
					});
					await this.rateLimitNotice.refresh();
					/*
					 * Topic 正文不在 request client 内自动重放，但横幅出现后仍应启动
					 * 唯一过盾恢复器：先探针，确实仍被盾拦截才开窗。恢复器只会
					 * 重放这里保存的最新失败目标一次，不改变其他请求的调度契约。
					 */
					this.#openManualCloudflareChallenge(
						this.#challengeHref,
						'',
						false,
					);
				}
				let previousRestored =
					previousTopicId !== null &&
					this.shell.activeTopicId === previousTopicId;
				if (
					previousTopicId !== null &&
					!previousRestored &&
					this.shell.activeTopicId === null
				) {
					const previous = await this.shell.open(
						previousTopicId,
						this.topicFactory,
					);
					if (!transactionIsCurrent()) return superseded();
					previousRestored =
						previous.status === 'opened' || previous.status === 'reused';
					if (previousRestored && previousAnchor) {
						try {
							await this.historyNavigation.restore(
								previousTopicId,
								previousAnchor,
							);
						} catch {
							this.feedback.show(
								'原帖子已恢复，但之前的阅读位置未能完整还原',
							);
						}
					}
				}
				if (previousRestored) {
					this.feedback.show('切换帖子失败，已保留当前帖子');
				} else {
					this.recovery.show(
						readerShellRecoveryFailure(
							result.cause,
							this.#challengeHref,
						),
					);
				}
			}
			return Object.freeze({ topic: result, navigation: null });
		} finally {
			this.#rememberBoostChronicleRequest(request, chronicleRequestFloor);
			if (this.#openRecoveryController === recoveryController) {
				this.#openRecoveryController = null;
			}
			releaseLoading?.();
		}
	}

	#highlightBoostTarget(
		request: ReaderBrowserTargetRequest,
		navigationElement: HTMLElement | undefined,
	): void {
		const boostId = Number(request.boostId);
		const postNumber = Number(request.postNumber);
		if (
			!Number.isSafeInteger(boostId) ||
			boostId <= 0 ||
			!Number.isSafeInteger(postNumber) ||
			postNumber <= 0
		) return;
		const roots = new Set<HTMLElement>();
		const navigationRoot = navigationElement?.matches('.ldp-post')
			? navigationElement
			: navigationElement?.closest<HTMLElement>('.ldp-post');
		if (navigationRoot?.isConnected) roots.add(navigationRoot);
		for (const root of this.shell.view.root.querySelectorAll<HTMLElement>(
			`.ldp-post[data-post-number="${postNumber}"]`,
		)) {
			roots.add(root);
		}
		const visibleCandidates: HTMLElement[] = [];
		let hiddenFallback: HTMLElement | null = null;
		for (const root of roots) {
			for (const bubble of root.querySelectorAll<HTMLElement>(
				'.ldp-boost-bubble[data-boost-id]',
			)) {
				if (
					bubble.closest<HTMLElement>('.ldp-post') !== root ||
					Number(bubble.dataset.boostId) !== boostId
				) continue;
				if (bubble.closest('[hidden],[aria-hidden="true"]')) {
					hiddenFallback ??= bubble;
				} else {
					visibleCandidates.push(bubble);
				}
			}
		}
		const target = visibleCandidates.find((bubble) =>
			bubble.closest('.ldp-descendant-replies-layer')) ??
			visibleCandidates.find((bubble) =>
				bubble.closest<HTMLElement>('.ldp-post') === navigationRoot) ??
			visibleCandidates[0] ?? hiddenFallback;
		if (target) this.#boostTargetHighlight.highlight(target);
	}

	async #recoverAvatarSource(
		source: string,
		signal?: AbortSignal,
	): Promise<string> {
		return this.imageResources?.resolveAvatarSource(source, signal) ?? '';
	}

	async close(): Promise<boolean> {
		this.#boostTargetHighlight.clear();
		this.#openRecoveryController?.abort(
			new DOMException('Reader 已关闭', 'AbortError'),
		);
		this.#openRecoveryController = null;
		this.#lastFailedRequest = null;
		this.recovery.clear();
		this.historyNavigation.captureCurrent();
		this.#closeApplicationSurfaces();
		return this.shell.closeTopic();
	}

	async #restoreQuoteSource(
		source: ReaderHistoryQuoteSource,
	): Promise<boolean> {
		if (this.#destroyed || this.scope.destroyed) return false;
		const topicId = discourseTopicId(source.topicId);
		const anchor = source.anchor === null
			? null
			: normalizeReaderHistoryAnchorState(source.anchor);
		const active = this.shell.activeValue;
		if (this.shell.activeTopicId === topicId && active) {
			if (anchor) {
				await this.historyNavigation.restore(topicId, anchor, {
					highlight: false,
				});
				const restored = this.shell.activeValue;
				if (!restored || !this.#restoreExactQuoteViewport(restored, anchor)) {
					return false;
				}
				this.#highlightQuoteSource(restored, source);
				return true;
			}
			const navigation = await active.topicNavigation.navigate({
				postNumber: source.postNumber,
				source: 'quote',
				alignment: 'nearest',
				highlight: true,
			});
			return navigation.status === 'revealed';
		}
		const opened = await this.openTarget({
			topicId,
			postNumber: anchor?.viewport.postNumber ?? source.postNumber,
			source: 'quote',
			alignment: 'nearest',
			highlight: anchor === null,
		});
		if (
			opened.topic.status !== 'opened' && opened.topic.status !== 'reused'
		) {
			return false;
		}
		if (!anchor) return opened.navigation?.status === 'revealed';
		await this.historyNavigation.restore(topicId, anchor, {
			highlight: false,
		});
		const restored = this.shell.activeValue;
		if (!restored || !this.#restoreExactQuoteViewport(restored, anchor)) {
			return false;
		}
		this.#highlightQuoteSource(restored, source);
		return true;
	}

	#restoreExactQuoteViewport(
		value: ReaderBrowserTopicContext<TTopic, TPost>,
		anchor: ReaderHistoryAnchorState,
	): boolean {
		const current = value.dom.captureViewportAnchor();
		if (current?.postNumber === anchor.viewport.postNumber) return true;
		/*
		 * 历史浏览保留整页比例语义；引用返回还承诺回到刚才离开的楼层。
		 * 比例因旧范围或虚拟高度变化没有落到记录楼层时，只丢弃比例几何，
		 * 继续复用同一 viewport 的楼层与楼内偏移做精确回退。
		 */
		return value.dom.restoreViewportAnchor({
			postNumber: anchor.viewport.postNumber,
			postOffset: anchor.viewport.postOffset,
			scrollTop: anchor.viewport.scrollTop,
		});
	}

	#highlightQuoteSource(
		value: ReaderBrowserTopicContext<TTopic, TPost>,
		source: ReaderHistoryQuoteSource,
	): void {
		if (
			source.anchor?.replyWindow &&
			value.topicContextSurface.highlightDiscussionPost(source.postNumber)
		) return;
		value.dom.highlightPost(source.postNumber);
	}

	readerSurfaceOpen(): boolean {
		if (this.shell.view.root.hidden) return false;
		if (
			this.actionSurfaces.active ||
			this.userCardView.isOpen ||
			this.userMediaViewer?.activeRoot?.isConnected
		) return true;
		const document = this.shell.view.root.ownerDocument;
		if (visibleDiscourseNativeFloatingSurface(document)) return true;
		return readerFrontmostEscapeSurface(document) !== null;
	}

	readerExitBlocked(): boolean {
		return this.composer.isOpen() || this.readerSurfaceOpen();
	}

	readerShortcutContextBlocked(): boolean {
		if (this.composer.isOpen()) return true;
		const document = this.shell.view.root.ownerDocument;
		return Boolean(readerSurfaceQuery(document, [
			'.ldp-settings-popover:not([hidden])',
			'.ldp-reader-action-layer:not([hidden])',
			'.ldp-lightbox',
			'.ldp-code-preview-layer',
		].join(',')));
	}

	handleCloseReaderShortcut(event: Event): boolean | Promise<boolean> {
		const binding = readerShortcutBindingFromEvent(event);
		if (binding !== 'Escape') {
			if (this.readerShortcutContextBlocked()) {
				return event.type !== 'keydown';
			}
			if (this.readerExitBlocked()) {
				this.#dispatchSurfaceCloseEscape();
				return true;
			}
		}
		return this.closeExpandedReply() || this.close();
	}

	closeExpandedReply(): boolean {
		const postNumber = this.shell.activeValue?.topicContextFeature
			.collapseExpandedDefaultPost() ?? null;
		if (!postNumber) return false;
		this.feedback.show(`已收起楼层 #${postNumber}`);
		return true;
	}

	#closeApplicationSurfaces(): void {
		this.userMediaViewer?.close();
		this.userCardView.close();
		this.actionSurfaces.closeActive();
	}

	#dispatchSurfaceCloseEscape(): void {
		const document = this.shell.view.root.ownerDocument;
		const window = document.defaultView;
		if (!window) return;
		let event: Event;
		if (typeof window.KeyboardEvent === 'function') {
			event = new window.KeyboardEvent('keydown', {
				key: 'Escape',
				code: 'Escape',
				bubbles: true,
				cancelable: true,
			});
		} else {
			event = new window.Event('keydown', {
				bubbles: true,
				cancelable: true,
			});
			Object.defineProperties(event, {
				key: { value: 'Escape', configurable: true },
				code: { value: 'Escape', configurable: true },
			});
		}
		readerSurfaceOnlyCloseEvents.add(event);
		document.dispatchEvent(event);
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#openRecoveryController?.abort(
			new DOMException('Reader runtime 已销毁', 'AbortError'),
		);
		this.#openRecoveryController = null;
		this.#lastFailedRequest = null;
		this.historyNavigation.captureCurrent();
		this.scope.destroy();
	}

	#openManualCloudflareChallenge(
		href: string,
		observationUsername = '',
		focus = true,
	): void {
		if (this.scope.destroyed) return;
		if (this.#manualChallengePromise) {
			if (focus) {
				/* 人工点击只唤起唯一共享浮窗；自动恢复重入不创建第二个 owner。 */
				void this.permit.resolveCloudflareChallenge({
					href,
					signal: this.#manualChallengeController.signal,
					focus: true,
				}).catch(() => {});
			}
			if (observationUsername) {
				void this.#manualChallengePromise.then((passed) => {
					if (passed && !this.scope.destroyed) {
						this.userObservations.retry(observationUsername);
					}
				}).catch(() => {});
			}
			return;
		}
		const failedRequest = this.#lastFailedRequest;
		const promise = this.permit.resolveCloudflareChallenge({
			href,
			signal: this.#manualChallengeController.signal,
			focus,
		}).then(async (passed) => {
			if (this.scope.destroyed) return passed;
			let retried = false;
			let recovered = false;
			if (passed) {
				await this.data.client.resetRateLimits();
				/*
				 * permit 已由原生 session 探针确认不再受 cf-mitigated；先立即
				 * 撤销横幅，再重放最新失败目标。若目标仍被盾拒绝，openTarget
				 * 会建立新的 required 世代并重新显示真实状态。
				 */
				await this.rateLimitNotice.refresh();
				/*
				 * session/current.json 只证明验证会话可通，不能替代刚才被
				 * cf-mitigated 拒绝的 Topic 请求。当前过盾恢复只重放当时仍为
				 * 最新的失败目标一次，让业务响应
				 * 成为最终判定；若它仍被盾拒绝，中央闸门会重新保持 required，
				 * 这里绝不循环或追发其他后台请求。
				 */
				if (
					failedRequest !== null &&
					this.#lastFailedRequest === failedRequest
				) {
					retried = true;
					const result = await this.openTarget({
						...failedRequest,
						forceRefresh: true,
					});
					recovered = result.topic.status === 'opened' ||
						result.topic.status === 'reused';
				}
				if (observationUsername) {
					this.userObservations.retry(observationUsername);
				} else if (!retried || recovered) {
					this.userObservations.resumeRecoverable('cloudflare-challenge');
				}
			}
			this.feedback.show(
				passed
					? observationUsername
						? `Cloudflare 验证已通过，@${observationUsername} 已从断点继续`
						: retried
						? recovered
							? 'Cloudflare 验证已通过，目标帖子已继续加载'
							: '验证会话已通过，但目标帖子仍被限制；未继续追发请求'
						: 'Cloudflare 验证已通过，请求已回到原有有序管线'
					: '验证浮窗未完成；请允许弹出窗口后重试',
			);
			return passed;
		}).catch((error) => {
			if (!this.#manualChallengeController.signal.aborted) {
				this.feedback.show('Cloudflare 验证未完成，请稍后重试');
			}
			throw error;
		}).finally(() => {
			if (this.#manualChallengePromise === promise) {
				this.#manualChallengePromise = null;
			}
		});
		this.#manualChallengePromise = promise;
		void promise.catch(() => {});
	}

	#applyPerformanceInfrastructure(): void {
		const snapshot = this.#performance;
		this.permit.applyRuntimePolicy({
			shortBudget: snapshot.requestShortBudget,
			longBudget: snapshot.requestLongBudget,
			minIntervalMs: snapshot.requestMinIntervalMs,
			maxConcurrent: snapshot.requestMaxConcurrent,
		});
		this.data.applyRequestRuntimePolicy({
			maxConcurrent: snapshot.requestMaxConcurrent,
		});
	}

	#historyArchiveMarker(
		topicId: number,
		postNumber: number,
	): ReaderHistoryArchiveMarker | null {
		const history = this.history as ReaderHistoryRepository | undefined;
		return history?.archiveMarker(topicId, postNumber) ?? null;
	}

	#captureAndRememberHistoryAnchor(): ReaderHistoryAnchorState | null {
		const anchor = this.#captureHistoryAnchor();
		const value = this.shell.activeValue;
		if (anchor && value) {
			this.#rememberHistoryTopic(
				value,
				anchor.viewport.postNumber,
				anchor.viewport,
			);
		}
		return anchor;
	}

	#captureHistoryAnchor(): ReaderHistoryAnchorState | null {
		const value = this.shell.activeValue;
		if (!value) return null;
		const viewport = value.dom.captureViewportAnchor();
		if (!viewport) return null;
		return normalizeReaderHistoryAnchorState({
			viewport,
			replyWindow:
				value.topicContextSurface.captureDiscussionState(),
			quoteHighlight:
					value.topicContextFeature.captureQuoteHighlightState(),
		});
	}

	#collectChronicleRequests(
		snapshot: RequestObservationSnapshot,
		context?: ReaderTopicRuntimeContext<
			TTopic,
			TPost,
			ReaderTopicCoreServices<TTopic, TPost>
		>,
	): void {
		const retained = new Set(snapshot.events.map((event) => event.id));
		for (const id of this.#chronicleRequestIds) {
			if (!retained.has(id)) this.#chronicleRequestIds.delete(id);
		}
		for (const event of snapshot.events) {
			if (this.#chronicleRequestIds.has(event.id) || event.pending) continue;
			const status = readerChronicleHttpStatus(event.status);
			if (
				event.phase !== 'finished' ||
				status === null ||
				event.cloudflareMitigated ||
				!event.sameOrigin
			) {
				this.#chronicleRequestIds.add(event.id);
				continue;
			}
			const target = readerChronicleRequestTarget(event.path);
			if (!target) {
				this.#chronicleRequestIds.add(event.id);
				continue;
			}
			const input = this.#chronicleInput(target, event, context);
			/* 缓存正文可能仍在同一个失效事务的后续 Session 提交中。 */
			if (!input) continue;
			try {
				this.chronicle.remember(input);
			} catch {
				/* 仓储已发布具名诊断；失效观察不得反向中断请求或改写缓存。 */
			} finally {
				this.#chronicleRequestIds.add(event.id);
			}
		}
	}

	#rememberChronicleArchives(
		value: ReaderTopicRuntimeContext<
			TTopic,
			TPost,
			ReaderTopicCoreServices<TTopic, TPost>
		>,
	): void {
		const session = value.services.session;
		const topicId = Number(session.topicId);
		if (!Number.isSafeInteger(topicId) || topicId <= 0) return;
		const topic = (session.topic ?? value.topic) as Readonly<{
			readonly title?: unknown;
		}> | null;
		const topicTitle = String(topic?.title ?? '').trim() ||
			this.history.entry(topicId)?.title || `帖子 #${topicId}`;
		const alreadyRemembered = (
			kind: 'topic' | 'reply',
			postNumber: number | null,
			status: ReaderChronicleStatus,
		): boolean => this.chronicle.snapshot.records.some((record) =>
			record.kind === kind &&
			Number(record.topicId) === topicId &&
			(kind === 'topic' || Number(record.postNumber) === postNumber) &&
			record.status === status
		);
		const remember = (
			kind: 'topic' | 'reply',
			postNumber: number | null,
			status: 403 | 404 | 410,
			confirmedAt: number,
		): void => {
			if (alreadyRemembered(kind, postNumber, status)) return;
			const post = postNumber === null
				? session.postByNumber(1)
				: session.postByNumber(postNumber);
			if (
				kind === 'reply' &&
				(
					!post ||
					(post as Readonly<{
						readonly reader_local_archive_placeholder?: unknown;
					}>).reader_local_archive_placeholder === true
				)
			) return;
			if (kind === 'topic' && !topic && !session.cachedPosts().length) return;
			const rawPostId = Number((post as Readonly<{
				readonly id?: unknown;
			}> | undefined)?.id);
			try {
				this.chronicle.remember({
					kind,
					status,
					bodyCached: true,
					topicId,
					topicTitle,
					...(postNumber === null ? {} : { postNumber }),
					...(Number.isSafeInteger(rawPostId) && rawPostId > 0
						? { postId: rawPostId }
						: {}),
					requestPath: postNumber === null
						? `/t/${topicId}.json`
						: `/posts/by_number/${topicId}/${postNumber}.json`,
					requestMethod: 'GET',
					requestSource: 'reader',
					callSite: 'topic-local-archive',
					observedAt: confirmedAt,
				});
			} catch {
				/* 仓储已发布具名诊断；史书回填不得反向改变 Topic 存档。 */
			}
		};
		const archive = session.localArchiveState();
		if (archive.topic) {
			remember(
				'topic',
				null,
				archive.topic.status,
				archive.topic.confirmedAt,
			);
		}
		for (const entry of archive.posts) {
			remember(
				'reply',
				Number(entry.postNumber),
				entry.status,
				entry.confirmedAt,
			);
		}
	}

	#rememberChronicleDeletedPosts(
		value: ReaderTopicRuntimeContext<
			TTopic,
			TPost,
			ReaderTopicCoreServices<TTopic, TPost>
		>,
		postNumbers: readonly number[] = value.services.session.cachedPosts().map((post) =>
			Number(post.post_number)),
		observedAt = Date.now(),
	): void {
		for (const postNumber of postNumbers) {
			this.#rememberChronicleDeletedPost(
				value,
				Number(postNumber),
				observedAt,
				'post-model:deleted_at',
				true,
			);
		}
	}

	#rememberChronicleDeletedPost(
		value: ReaderTopicRuntimeContext<
			TTopic,
			TPost,
			ReaderTopicCoreServices<TTopic, TPost>
		>,
		postNumber: number,
		observedAt: number,
		callSite: string,
		requireDeletedModel: boolean,
	): void {
		if (!Number.isSafeInteger(postNumber) || postNumber < 1) return;
		const post = value.services.session.postByNumber(postNumber);
		if (!post) return;
		const source = post as TPost & Readonly<{
			readonly deleted_at?: unknown;
			readonly deletedAt?: unknown;
		}>;
		const deletedAt = source.deleted_at ?? source.deletedAt;
		if (requireDeletedModel && !deletedAt) return;
		const topicId = Number(value.services.session.topicId);
		const kind = postNumber === 1 ? 'topic' : 'reply';
		if (this.chronicle.snapshot.records.some((record) =>
			record.kind === kind &&
			Number(record.topicId) === topicId &&
			(kind === 'topic' || Number(record.postNumber) === postNumber) &&
			record.status === 'deleted'
		)) return;
		const topic = (
			value.services.session.topic ?? value.topic
		) as Readonly<{ readonly title?: unknown }>;
		const parsedDeletedAt = Date.parse(String(deletedAt ?? ''));
		try {
			this.chronicle.remember({
				kind,
				status: 'deleted',
				bodyCached: true,
				topicId,
				topicTitle: String(topic.title ?? '').trim() ||
					this.history.entry(topicId)?.title,
				...(kind === 'reply' ? { postNumber } : {}),
				postId: Number(post.id),
				requestPath: kind === 'topic'
					? `/t/${topicId}.json`
					: `/posts/by_number/${topicId}/${postNumber}.json`,
				requestMethod: 'GET',
				requestSource: 'host',
				callSite,
				observedAt: Number.isFinite(parsedDeletedAt)
					? parsedDeletedAt
					: observedAt,
			});
		} catch {
			/* 删除模型记录失败不得反向改变 Topic canonical 或实时事件。 */
		}
	}

	#rememberBoostChronicleRequest(
		request: ReaderBrowserTargetRequest,
		requestFloor: number,
	): void {
		const boostId = Number(request.boostId);
		if (!Number.isSafeInteger(boostId) || boostId <= 0) return;
		const resolvedBoost = this.#chronicleBoostTarget(boostId);
		for (const event of this.data.requests.snapshot.events) {
			const status = readerChronicleHttpStatus(event.status);
			if (
				event.id <= requestFloor ||
				event.phase !== 'finished' ||
				status === null ||
				event.cloudflareMitigated ||
				!event.sameOrigin
			) continue;
			const target = readerChronicleRequestTarget(event.path);
			/* Boost 自身端点已经由被动 collector 归类，避免同一信号重复计数。 */
			if (!target || target.kind === 'boost') continue;
			const resolvedRequest = this.#chronicleInput(target, event);
			if (!resolvedRequest || Number(resolvedRequest.topicId) !== request.topicId) {
				continue;
			}
			try {
				this.chronicle.remember({
					kind: 'boost',
					status,
					bodyCached: true,
					topicId: request.topicId,
					topicTitle: resolvedBoost?.topicTitle ||
						this.history.entry(request.topicId)?.title,
					postNumber: resolvedBoost?.postNumber ?? request.postNumber,
					postId: resolvedBoost?.postId,
					boostId,
					requestPath: event.path,
					requestMethod: event.method,
					requestSource: event.source,
					callSite: [
						`boost-target:${request.source}`,
						event.callSite,
					].filter(Boolean).join(' · '),
					observedAt: event.endedAt || event.startedAt,
				});
			} catch {
				/* 失效记录失败不得删除缓存，也不得反向改变打开事务结果。 */
			}
		}
	}

	#chronicleInput(
		target: ReaderChronicleRequestTarget,
		event: RequestObservationEvent,
		context?: ReaderTopicRuntimeContext<
			TTopic,
			TPost,
			ReaderTopicCoreServices<TTopic, TPost>
		>,
	): ReaderChronicleInput | null {
		const status = readerChronicleHttpStatus(event.status);
		if (status === null || event.cloudflareMitigated) return null;
		let targetKind = target.kind;
		let topicId = target.topicId;
		let postNumber = target.postNumber;
		let postId = target.postId;
		const boostId = target.boostId;
		let topicTitle = '';
		const active = context ?? this.shell.activeValue;
		if (postId !== null && active) {
			const post = active.services.session.postById(postId);
			const resolved = tryDiscoursePostNumber(post?.post_number);
			if (resolved !== null) {
				topicId = Number(active.services.session.topicId);
				postNumber = resolved;
				targetKind = resolved === 1 ? 'topic' : 'reply';
			}
		}
		if (targetKind === 'boost' && boostId !== null) {
			const resolved = this.#chronicleBoostTarget(boostId);
			if (resolved) {
				topicId = resolved.topicId;
				postNumber = resolved.postNumber;
				postId = resolved.postId;
				topicTitle = resolved.topicTitle;
			}
		}
		if (topicId === null && postId !== null) {
			const activity = this.bookmarkController?.activitySyncRecords().find(
				(entry) => entry.postId === postId,
			);
			if (activity) {
				topicId = Number(activity.topicId);
				postNumber = Number(activity.postNumber);
				topicTitle = activity.title;
				targetKind = postNumber === 1 ? 'topic' : 'reply';
			}
		}
		if (topicId === null) return null;
		if (targetKind === 'reply' && postNumber === null && postId === null) {
			return null;
		}
		if (targetKind === 'boost' && boostId === null) return null;
		if (
			!topicTitle &&
			active &&
			Number(active.services.session.topicId) === topicId
		) {
			const topic = (
				active.services.session.topic ?? active.topic
			) as Readonly<{ readonly title?: unknown }>;
			topicTitle = String(topic.title ?? '').trim();
		}
		topicTitle ||= this.history.entry(topicId)?.title ?? `帖子 #${topicId}`;
		const cachedPost = active &&
			Number(active.services.session.topicId) === topicId
			? postNumber !== null
				? active.services.session.postByNumber(postNumber)
				: postId !== null
					? active.services.session.postById(postId)
					: targetKind === 'topic'
						? active.services.session.postByNumber(1)
						: undefined
			: undefined;
		if (
			!cachedPost ||
			(cachedPost as Readonly<{
				readonly reader_local_archive_placeholder?: unknown;
			}>).reader_local_archive_placeholder === true
		) return null;
		return Object.freeze({
			kind: targetKind,
			status,
			bodyCached: true,
			topicId,
			topicTitle,
			...(postNumber === null ? {} : { postNumber }),
			...(postId === null ? {} : { postId }),
			...(boostId === null ? {} : { boostId }),
			requestPath: event.path,
			requestMethod: event.method,
			requestSource: event.source,
			callSite: event.callSite,
			observedAt: event.endedAt || event.startedAt,
		});
	}

	#chronicleBoostTarget(boostId: number): Readonly<{
		readonly topicId: number;
		readonly postNumber: number;
		readonly postId: number | null;
		readonly topicTitle: string;
	}> | null {
		const active = this.shell.activeValue;
		if (active) {
			for (const post of active.services.session.cachedPosts()) {
				const source = post as Readonly<Record<string, unknown>>;
				const boosts = Array.isArray(source.boosts)
					? source.boosts
					: source.boosts ? [source.boosts] : [];
				const found = boosts.some((value) =>
					value !== null &&
					typeof value === 'object' &&
					Number((value as Readonly<{ readonly id?: unknown }>).id) === boostId);
				if (!found) continue;
				const topic = (
					active.services.session.topic ?? active.topic
				) as Readonly<{ readonly title?: unknown }>;
				return Object.freeze({
					topicId: Number(active.services.session.topicId),
					postNumber: Number(post.post_number),
					postId: Number.isSafeInteger(Number(post.id))
						? Number(post.id)
						: null,
					topicTitle: String(topic.title ?? '').trim(),
				});
			}
		}
		const activity = this.bookmarkController?.activitySyncRecords().find(
			(entry) => entry.tab === 'Boost' && entry.identity === `boost:${boostId}`,
		);
		if (activity) {
			return Object.freeze({
				topicId: Number(activity.topicId),
				postNumber: Number(activity.postNumber),
				postId: activity.postId === null ? null : Number(activity.postId),
				topicTitle: activity.title,
			});
		}
		const notification = this.notificationController?.syncHistoryRecords().find(
			(entry) => entry.group === 'boosts' &&
				entry.identity === `boosts:${boostId}`,
		);
		return notification?.target
			? Object.freeze({
				topicId: Number(notification.target.topicId),
				postNumber: Number(notification.target.postNumber),
				postId: null,
				topicTitle: this.history.entry(notification.target.topicId)?.title ??
					`帖子 #${notification.target.topicId}`,
			})
			: null;
	}

	#rememberHistoryTopicMetadata(
		value: ReaderBrowserTopicContext<TTopic, TPost>,
	): void {
		this.#rememberHistoryTopic(
			value,
			this.history.entry(value.services.session.topicId)?.postNumber ?? 1,
		);
	}

	#rememberHistoryTopic(
		value: ReaderBrowserTopicContext<TTopic, TPost>,
		postNumber: number = value.topicTimeline.snapshot.currentPostNumber,
		viewport?: ReaderHistoryViewport,
	): void {
		const topic = (
			value.services.session.topic ?? value.topic
		) as TTopic & Readonly<{
			title?: unknown;
			details?: Readonly<{
				created_by?: Readonly<{
					avatar_template?: unknown;
					username?: unknown;
				}>;
			}>;
		}>;
		const topicHeader = value.topicHeader.snapshot;
		const posts = value.services.session.cachedPosts();
		const firstPost = posts.find((post) =>
			tryDiscoursePostNumber(post.post_number) === 1
		);
		const topicObservationMetadata = normalizeReaderUserTopicMetadata(
			value.services.session.topicId,
			topic,
			firstPost,
		);
		const headerObservationMetadata = normalizeReaderUserTopicMetadata(
			value.services.session.topicId,
			Object.freeze({
				title: topicHeader.title,
				category_id: topicHeader.categoryId || null,
				category_name: topicHeader.category?.name ?? '',
				tags: Object.freeze(topicHeader.tags.map((tag) => tag.name)),
			}),
		);
		const observationMetadata = topicObservationMetadata && headerObservationMetadata
			? mergeReaderUserTopicMetadata(
				topicObservationMetadata,
				headerObservationMetadata,
			)
			: topicObservationMetadata ?? headerObservationMetadata;
		if (observationMetadata) {
			this.userObservations.rememberTopicMetadata(observationMetadata);
		}
		const readPostNumbers = posts
			.filter((post) =>
				(post as TPost & Readonly<{ read?: unknown }>).read === true
			)
			.map((post) => post.post_number);
		readPostNumbers.push(
			...value.services.read.snapshot().confirmed,
		);
		const archive = value.services.session.localArchiveState();
		const floorArchive = archive.posts.find(
			(entry) => entry.postNumber === postNumber,
		) ?? null;
		try {
			this.history.remember({
				topicId: value.services.session.topicId,
				title: topicHeader.title || topic.title,
				postsCount: Math.max(
					Number(topic.posts_count) || 0,
					Number(topic.highest_post_number) || 0,
				),
				avatarTemplate:
					topic.details?.created_by?.avatar_template ??
					(firstPost as TPost & Readonly<{
						avatar_template?: unknown;
					}> | undefined)?.avatar_template,
				ownerUsername:
					topic.details?.created_by?.username ??
					firstPost?.username,
				topicSubtitle: topicHeader.statsText ===
						'主题信息暂不可用'
					? ''
					: topicHeader.statsText,
				categoryId: topicHeader.categoryId || null,
				categoryName: topicHeader.category?.name ?? '',
				tags: topicHeader.tags.map((tag) => tag.name),
				...(viewport === undefined ? {} : { viewport }),
				postNumber,
				readPostNumbers,
				archiveStatus:
					archive.topic?.status ?? floorArchive?.status ?? null,
				archivePostNumber: archive.topic === null
					? floorArchive?.postNumber ?? null
					: null,
			});
		} catch {
			// Repository 已发布 write-failed；历史持久化不得反向中断已打开 Topic。
		}
	}

	#historyOpenResult(
		result: ReaderShellOpenResult<ReaderBrowserTopicContext<TTopic, TPost>>,
	): ReaderHistoryOpenResult {
		if (result.status === 'failed') {
			return Object.freeze({
				status: 'failed',
				topicId: result.topicId,
				cause: result.cause,
			});
		}
		return Object.freeze({
			status: result.status,
			topicId: result.topicId,
		});
	}

	async #openHistoryEntry(entry: ReaderHistoryEntry): Promise<void> {
		const anchor = this.historyNavigation.snapshot.states[
			String(entry.topicId)
		] ?? (entry.viewport === null
			? null
			: normalizeReaderHistoryAnchorState({ viewport: entry.viewport }));
		const opened = await this.openTarget({
			topicId: entry.topicId,
			source: 'restore',
		});
		if (
			anchor === null ||
			(opened.topic.status !== 'opened' && opened.topic.status !== 'reused')
		) return;
		await this.historyNavigation.restore(entry.topicId, anchor, {
			highlight: false,
			restoreSemanticState: false,
		});
	}
}

/**
 * ReaderApplication 的必需浏览器 stage。Shell、Workspace 和数据运行时在同一个事务中创建，
 * 任一环节失败都会由 application/shell scope 反向释放。
 */
export function createReaderBrowserRuntimeStage<
	TPreferences extends object,
	TTopic extends DiscourseComposerTopicInput<TPost>,
	TPost extends ReaderLightboxCommentPostInput
		& DiscourseComposerPostInput
		& CanonicalActionPost,
>(
	options: ReaderBrowserRuntimeStageOptions<TPreferences, TTopic, TPost>,
): ReaderApplicationStage<TPreferences> {
	const appearanceByShell = new WeakMap<
		ReaderShell<ReaderBrowserTopicContext<TTopic, TPost>>,
		ReaderAppearanceStyleController<TPreferences>
	>();
	const themeByShell = new WeakMap<
		ReaderShell<ReaderBrowserTopicContext<TTopic, TPost>>,
		ReaderThemeController<TPreferences>
	>();
	const fontByShell = new WeakMap<
		ReaderShell<ReaderBrowserTopicContext<TTopic, TPost>>,
		ReaderFontStyleController<TPreferences>
	>();
	const appearancePreferences = options.appearance || undefined;
	const themeOptions = options.theme || undefined;
	const fontPreferences = options.font || undefined;
	const motionPreferences = options.motion || undefined;
	const boostCopyPreferences = options.boostCopy || undefined;
	if (motionPreferences && options.selectNavigationPreferences) {
		throw new Error(
			'动画设置与独立导航偏好选择器只能配置一个',
		);
	}
	const selectNavigationPreferences = motionPreferences
		? (preferences: Readonly<TPreferences>) =>
			readerMotionNavigationPreferences(
				motionPreferences.read(preferences),
			)
		: options.selectNavigationPreferences;
	const shellOptions =
		appearancePreferences || themeOptions || fontPreferences
		? Object.freeze({
			...options.shell,
			createWorkspaceOptions: (
				shell: ReaderShell<
					ReaderBrowserTopicContext<TTopic, TPost>
				>,
				context: ReaderApplicationContext<TPreferences>,
			) => {
				const workspaceOptions =
					options.shell.createWorkspaceOptions(shell, context);
				const theme = themeOptions
					? new ReaderThemeController<TPreferences>({
						root: shell.view.root,
						preferences: themeOptions.preferences,
						readPreferences: context.readPreferences,
						preferenceChanges: context.preferenceChanges,
						system: themeOptions.system,
						...(themeOptions.clock
							? { clock: themeOptions.clock }
							: {}),
						parentScope: shell.scope,
					})
					: null;
				if (theme) themeByShell.set(shell, theme);
				const appearance = appearancePreferences
					? new ReaderAppearanceStyleController<TPreferences>({
						root: shell.view.root,
						preferences: appearancePreferences,
						readPreferences: context.readPreferences,
						preferenceChanges: context.preferenceChanges,
						environment: {
							read: () => Object.freeze({
								...workspaceOptions.readAppearance(),
								...(theme
									? { theme: theme.snapshot.resolved }
									: {}),
							}),
							subscribe: (listener, scope) => {
								const publish = () => listener(
									Object.freeze({
										...workspaceOptions.readAppearance(),
										...(theme
											? {
												theme:
													theme.snapshot.resolved,
											}
											: {}),
									}),
								);
								workspaceOptions.appearanceChanges?.subscribe(
									publish,
									scope,
								);
								theme?.changes.subscribe(publish, scope);
								return () => {};
							},
						},
						parentScope: shell.scope,
					})
					: null;
				if (appearance) appearanceByShell.set(shell, appearance);
				const font = fontPreferences
					? new ReaderFontStyleController<TPreferences>({
						root: shell.view.root,
						pageRoot: workspaceOptions.elements.pageRoot,
						resizeTarget: shell.view.modal,
						preferences: fontPreferences,
						readPreferences: context.readPreferences,
						preferenceChanges: context.preferenceChanges,
						readReaderWidth: () =>
							shell.view.modal.clientWidth || 1_080,
						readSiteFontFamily: () => {
							const target =
								options.runtime.document.body ??
								workspaceOptions.elements.pageRoot;
							return options.runtime.document.defaultView
								?.getComputedStyle(target).fontFamily ||
								'inherit';
						},
						readExternalFontRendering: () => {
							const pageRoot =
								workspaceOptions.elements.pageRoot;
							if (!pageRoot.hasAttribute('fr-init-once')) {
								return false;
							}
							return (
								options.runtime.document.defaultView
									?.getComputedStyle(pageRoot)
									.getPropertyValue('--fr-render-text')
									.trim() ?? ''
							) !== '';
						},
						userAgent:
							options.runtime.document.defaultView?.navigator
								.userAgent ?? '',
						platform:
							options.runtime.document.defaultView?.navigator
								.platform ?? '',
						...(workspaceOptions.createMutationObserver
							? {
								createMutationObserver:
									workspaceOptions.createMutationObserver,
							}
							: {}),
						...(workspaceOptions.createResizeObserver
							? {
								createResizeObserver:
									workspaceOptions.createResizeObserver,
							}
							: {}),
						parentScope: shell.scope,
					})
					: null;
				if (font) fontByShell.set(shell, font);
				return Object.freeze({
					...workspaceOptions,
					...(appearance
						? {
							readAppearance: () =>
								appearance.snapshot.embedded,
							appearanceChanges:
								appearance.embeddedChanges,
						}
						: {}),
				});
			},
		})
		: options.shell;
	return createReaderShellWorkspaceStage<
		TPreferences,
		ReaderBrowserTopicContext<TTopic, TPost>>({
		...shellOptions,
		onReady(shell, workspace, context) {
			const theme = themeByShell.get(shell) ?? null;
			const appearance = appearanceByShell.get(shell) ?? null;
			const font = fontByShell.get(shell) ?? null;
			const queryLocalFonts = createReaderLocalFontQuery(
				options.runtime.document,
			);
			const sharedFontCatalog = new ReaderFontCatalog({
				document: options.runtime.document,
				indexedDb: options.runtime.indexedDb ?? null,
				...(queryLocalFonts ? { queryLocalFonts } : {}),
				...(options.runtime.fontStylesheet
					? { appendStylesheet: options.runtime.fontStylesheet }
					: {}),
			});
			shell.scope.add(() => {
				void sharedFontCatalog.destroy();
			});
			const rawNavigation = options.runtime.navigation;
			if (boostCopyPreferences && options.runtime.boostCopy) {
				throw new Error(
					'Boost 复制偏好投影与自定义 runtime 读取器只能配置一个',
				);
			}
			const boostCopy = boostCopyPreferences
				? Object.freeze({
					readSettings: () => boostCopyPreferences.read(
						context.readPreferences(),
					),
				})
				: options.runtime.boostCopy;
			const topicActionRailPreferences = options.topicActionRail;
			if (
				topicActionRailPreferences &&
				options.runtime.topicActionRail !== undefined
			) {
				throw new Error(
					'主帖操作列偏好投影与自定义 runtime 端口只能配置一个',
				);
			}
			if (topicActionRailPreferences && !context.updatePreferences) {
				throw new Error(
					'主帖操作列拖动与收纳需要 application 唯一偏好写端口',
				);
			}
			const topicActionRail = topicActionRailPreferences === false
				? false
				: topicActionRailPreferences
					? Object.freeze<ReaderTopicActionRailPreferencesPort>({
						read: () => topicActionRailPreferences.read(
							context.readPreferences(),
						),
						subscribe: (listener, scope) =>
							context.preferenceChanges.subscribe(
								(preferences) => listener(
									topicActionRailPreferences.read(preferences),
								),
								scope,
							),
						update: (patch) => {
							const current = topicActionRailPreferences.read(
								context.readPreferences(),
							);
							context.updatePreferences!(
								topicActionRailPreferences.createPatch(
									Object.freeze({
										...current,
										...patch,
									}),
								),
							);
						},
					})
					: options.runtime.topicActionRail;
			if (
				options.selectPerformancePreferences &&
				options.runtime.performance
			) {
				throw new Error(
					'性能偏好投影与自定义 runtime performance 只能配置一个',
				);
			}
			const performancePolicy = options.selectPerformancePreferences
				? new ReaderPerformancePolicy({
					preferences: options.selectPerformancePreferences(
						context.readPreferences(),
					),
					shortBudgetCeiling:
						options.performanceBudgetCeilings?.short ??
						options.runtime.permit.shortBudget,
					longBudgetCeiling:
						options.performanceBudgetCeilings?.long ??
						options.runtime.permit.longBudget,
					capabilities: readBrowserPerformanceCapabilities(
						options.runtime.document.defaultView?.navigator,
					),
				})
				: null;
			if (
				selectNavigationPreferences &&
				(
					rawNavigation?.readOverscan ||
					rawNavigation?.readMaxMountedPostCount ||
					rawNavigation?.readLifetimeMs
				)
			) {
				throw new Error(
					'导航偏好投影与自定义虚拟窗口/高亮读取器只能配置一个',
				);
			}
			const navigationPreferences = selectNavigationPreferences
				? new ReaderTopicNavigationPreferenceProjection({
					root: shell.view.root,
					preferences: selectNavigationPreferences(
						context.readPreferences(),
					),
					...(performancePolicy === null
						? {}
						: {
							readPerformance: () =>
								performancePolicy.value,
						}),
					parentScope: shell.scope,
				})
				: null;
			const navigation = navigationPreferences
				? Object.freeze({
					...rawNavigation,
					readOverscan: () => navigationPreferences.readOverscan(),
					readMaxMountedPostCount: () =>
						navigationPreferences.readMaxMountedPostCount(),
					readLifetimeMs: () =>
						navigationPreferences.readHighlightLifetimeMs(),
				})
				: rawNavigation;
			const rawHistory = options.runtime.history;
			if (
				options.selectHistoryNavigationPreferences &&
				rawHistory?.navigationView
			) {
				throw new Error(
					'历史导航偏好投影与自定义 navigationView 只能配置一个',
				);
			}
			const navigationHistory = options.selectHistoryNavigationPreferences
				? Object.freeze({
					...rawHistory,
					navigationView: Object.freeze({
						preferences:
							options.selectHistoryNavigationPreferences(
								context.readPreferences(),
							),
					}),
				})
				: rawHistory;
			if (
				options.selectHistoryPanelPreferences &&
				!navigationHistory?.panelView
			) {
				throw new Error(
					'历史列表偏好投影需要先配置唯一 panelView 端口',
				);
			}
			const history = options.selectHistoryPanelPreferences
				? Object.freeze({
					...navigationHistory,
					readSortMode: () =>
						options.selectHistoryPanelPreferences!(
							context.readPreferences(),
						).sortMode,
					panelView: Object.freeze({
						...navigationHistory!.panelView!,
						preferences:
							options.selectHistoryPanelPreferences(
								context.readPreferences(),
							),
					}),
				})
				: navigationHistory;
			const rawBookmarks = options.runtime.bookmarks;
			if (options.selectBookmarkPreferences && rawBookmarks === false) {
				throw new Error(
					'收藏偏好投影与禁用收藏中心不能同时配置',
				);
			}
			const bookmarks = options.selectBookmarkPreferences
				? Object.freeze({
					...(rawBookmarks ?? {}),
					tabOrder: options.selectBookmarkPreferences(
						context.readPreferences(),
					).tabOrder,
				})
				: rawBookmarks;
			const rawTimelineView = options.runtime.timelineView;
			if (
				options.selectTimelineViewPreferences &&
				(!rawTimelineView || rawTimelineView.readPreferences)
			) {
				throw new Error(
					'时间轴偏好投影需要唯一 timelineView，且不能同时注入自定义读取器',
				);
			}
			let timelinePreferences =
				options.selectTimelineViewPreferences?.(
					context.readPreferences(),
				) ?? null;
			const timelineView =
				options.selectTimelineViewPreferences && rawTimelineView
					? Object.freeze({
						...rawTimelineView,
						preferences: timelinePreferences!,
						readPreferences: () => timelinePreferences!,
					})
					: rawTimelineView;
			if (
				(options.selectTranslationMode === undefined) !==
				(options.persistTranslationMode === undefined)
			) {
				throw new Error(
					'翻译偏好投影必须同时提供 selectTranslationMode 与 persistTranslationMode',
				);
			}
			const rawTranslationView = options.runtime.translationView;
			if (
				options.selectTranslationMode &&
				rawTranslationView === false
			) {
				throw new Error(
					'翻译偏好投影与禁用翻译 View 不能同时配置',
				);
			}
			if (
				options.selectTranslationMode &&
				rawTranslationView &&
				(
					rawTranslationView.initialMode !== undefined ||
					rawTranslationView.persistMode !== undefined
				)
			) {
				throw new Error(
					'翻译偏好投影与自定义 initialMode/persistMode 只能配置一个',
				);
			}
			const translationView = options.selectTranslationMode
				? Object.freeze({
					...(rawTranslationView || {}),
					initialMode: options.selectTranslationMode(
						context.readPreferences(),
					),
					persistMode: options.persistTranslationMode!,
				})
					: rawTranslationView;
			const imagePreferences = options.image || null;
			const rawLightbox = options.runtime.lightbox;
			if (imagePreferences && rawLightbox?.preferences) {
				throw new Error(
					'图片偏好投影与自定义 Lightbox 偏好端口只能配置一个',
				);
			}
			if (imagePreferences && rawLightbox && !context.updatePreferences) {
				throw new Error(
					'Lightbox 几何持久化需要 application 唯一偏好写端口',
				);
			}
			const lightbox = imagePreferences && rawLightbox
				? Object.freeze({
					...rawLightbox,
					preferences: Object.freeze<ReaderLightboxPreferencesPort>({
						read: () => {
							const current = imagePreferences.read(
								context.readPreferences(),
							);
							return Object.freeze({
								originalByDefault:
									current.lightboxOriginalByDefault,
								commentsExpanded:
									current.lightboxCommentsExpandedByDefault,
								descriptionExpanded:
									current.lightboxDescriptionExpanded,
								lightboxDescriptionHeight:
									current.lightboxDescriptionHeight,
								lightboxCommentsWidthPercent:
									current.lightboxCommentsWidthPercent,
							});
						},
						update: (patch) => {
							const current = imagePreferences.read(
								context.readPreferences(),
							);
							const next = normalizeReaderImagePreferences({
								...current,
								...(patch.originalByDefault === undefined
									? {}
									: {
										lightboxOriginalByDefault:
											patch.originalByDefault,
									}),
								...(patch.commentsExpanded === undefined
									? {}
									: {
										lightboxCommentsExpandedByDefault:
											patch.commentsExpanded,
									}),
								...(patch.descriptionExpanded === undefined
									? {}
									: {
										lightboxDescriptionExpanded:
											patch.descriptionExpanded,
									}),
								...(patch.lightboxDescriptionHeight === undefined
									? {}
									: {
										lightboxDescriptionHeight:
											patch.lightboxDescriptionHeight,
									}),
								...(patch.lightboxCommentsWidthPercent === undefined
									? {}
									: {
										lightboxCommentsWidthPercent:
											patch.lightboxCommentsWidthPercent,
									}),
							} as Partial<ReaderImagePreferences>);
							context.updatePreferences!(
								imagePreferences.createPatch(next),
							);
						},
					}),
				})
				: rawLightbox;
				const loadingAnimation = motionPreferences
				? new ReaderLoadingAnimationView({
					document: options.runtime.document,
					host: shell.view.body,
					shell,
					preference: motionPreferences.read(
						context.readPreferences(),
					).loadingAnimation,
					siteName: motionPreferences.siteName,
					parentScope: shell.scope,
					})
					: null;
					let downloadCurrentTopic: (() => void) | null = null;
					const runtime = new ReaderBrowserRuntime<TTopic, TPost>({
					...options.runtime,
				...(performancePolicy === null
					? {}
					: { performance: performancePolicy.value }),
				...(navigation === undefined ? {} : { navigation }),
				...(history === undefined ? {} : { history }),
				...(bookmarks === undefined ? {} : { bookmarks }),
				...(timelineView === undefined ? {} : { timelineView }),
				...(translationView === undefined
					? {}
					: { translationView }),
				...(lightbox === undefined ? {} : { lightbox }),
				...(boostCopy === undefined ? {} : { boostCopy }),
					...(topicActionRail === undefined
						? {}
						: { topicActionRail }),
					topicSummaryFonts: Object.freeze({
						readCurrentFamily: () =>
							options.runtime.document.defaultView
								?.getComputedStyle(shell.view.root)
								.getPropertyValue('--ldp-post-font-family')
								.trim() || 'system-ui,sans-serif',
						...(queryLocalFonts ? { queryLocalFonts } : {}),
						entries: () => sharedFontCatalog.entries(),
						entry: (id: string) => sharedFontCatalog.entry(id),
						ensureLoaded: (id: string) =>
							sharedFontCatalog.ensureLoaded(id),
						subscribe: (listener: () => void) =>
							sharedFontCatalog.subscribe(listener),
					}),
					...(options.openQueue && options.runtime.resources
						? {
							downloadCurrentTopic: () => downloadCurrentTopic?.(),
						}
						: {}),
						shell,
					workspace,
					...(loadingAnimation
						? { loadingProgress: loadingAnimation }
						: {}),
					parentScope: shell.scope,
				});
			const reportCacheError = (cause: unknown): void => {
				try {
					options.runtime.onTopicFeatureError?.(Object.freeze({
						topicId: runtime.shell.activeTopicId ?? 0,
						feature: 'cache',
						cause,
					}));
				} catch {
					// 缓存诊断 consumer 失败不能破坏设置面板或清理事务。
				}
			};
			new DiscourseNativeAjaxObservationAdapter({
				observer: runtime.data.requests,
				jqueryModule:
					discourseNativeJqueryModule(options.runtime.host),
				document: options.runtime.document,
				hostRequestBudget: runtime.permit,
			}).install(runtime.scope);
				const refreshTopicButton =
					shell.view.root.querySelector<HTMLButtonElement>(
						'.ldp-reader-refresh',
					);
				const closeReaderButton =
					shell.view.root.querySelector<HTMLButtonElement>(
						'.ldp-close',
					);
				const layoutToggleButton =
					shell.view.root.querySelector<HTMLButtonElement>(
						'.ldp-layout-toggle',
					);
				if (
					!refreshTopicButton ||
					!closeReaderButton ||
					!layoutToggleButton
				) {
					runtime.destroy();
					throw new Error('Reader Shell 缺少布局、刷新或关闭入口');
				}
				let currentTopicRefresh:
					Promise<ReaderCurrentTopicRefreshResult> | null = null;
				const syncHeaderTopicActions = (): void => {
					refreshTopicButton.disabled =
						currentTopicRefresh !== null ||
						runtime.shell.activeValue === null;
					const presentation =
						workspace.workspace.snapshot.presentation;
					const fullPage = presentation.fullPage;
					layoutToggleButton.hidden = presentation.embedded;
					layoutToggleButton.setAttribute(
						'aria-pressed',
						String(fullPage),
					);
					layoutToggleButton.setAttribute(
						'aria-label',
						fullPage ? '切换为浮窗阅读器' : '切换为全屏阅读器',
					);
					layoutToggleButton.title =
						fullPage ? '切换为浮窗阅读器' : '切换为全屏阅读器';
					layoutToggleButton.replaceChildren(renderReaderIcon(
						options.runtime.document,
						fullPage ? 'minimize-2' : 'maximize-2',
						options.runtime.renderIcon,
					));
				};
				const refreshCurrentTopic = (
					refreshOptions: Readonly<{
						readonly clearImages?: boolean;
					}> = {},
				):
					Promise<ReaderCurrentTopicRefreshResult> => {
					if (currentTopicRefresh) return currentTopicRefresh;
					const topicId = runtime.shell.activeTopicId;
					const active = runtime.shell.activeValue;
					if (!topicId || !active) {
						return Promise.reject(new Error('当前没有可重建的主题'));
					}
					const transaction = (async ():
						Promise<ReaderCurrentTopicRefreshResult> => {
						const anchor = runtime.historyNavigation.captureCurrent();
						/*
						 * 清缓存会重建整棵虚拟树；旧 scrollRatio 的分母属于旧布局，不能
						 * 再映射到新首包。刷新事务必须以真实可见楼层及楼层内偏移为 owner，
						 * 回复窗口与引用语义仍沿用同一历史恢复入口。
						 */
						const exactAnchor: ReaderHistoryAnchorState | null = anchor === null
							? null
							: Object.freeze({
								...anchor,
								viewport: Object.freeze({
									postNumber: anchor.viewport.postNumber,
									postOffset: anchor.viewport.postOffset,
									scrollTop: anchor.viewport.scrollTop,
								}),
							});
						const onlyOpEnabled = active.topicOnlyOp.snapshot.enabled;
						const imageSnapshot = active.topicImages.snapshot();
						const sources = imageSnapshot.items.flatMap((item) => [
							item.previewSrc,
							item.originalSrc,
						]);
						if (
							runtime.shell.activeTopicId !== topicId ||
							runtime.shell.activeValue !== active
						) {
							throw new Error('当前主题已切换，已取消缓存重建');
						}
						if (!await runtime.shell.closeTopic()) {
							throw new Error('当前主题关闭事务失败');
						}
						// prepareClose 会 flush 当前 snapshot，必须在关闭落盘之后再失效；
						// 否则旧会话会把刚清理的 Topic/树快照重新写回数据库。
						const cleanupFailures: unknown[] = [];
						try {
							const report = await runtime.data.responses
								.invalidateWithReport({ tags: [`topic:${topicId}`] });
							cleanupFailures.push(...report.failures.map(
								(failure) => failure.cause,
							));
						} catch (cause) {
							cleanupFailures.push(cause);
						}
						if (
							refreshOptions.clearImages !== false &&
							runtime.imageResources &&
							sources.length
						) {
							try {
								const report = await runtime.imageResources
									.invalidateSources(sources);
								cleanupFailures.push(...report.failures.map(
									(failure) => failure.cause,
								));
							} catch (cause) {
								cleanupFailures.push(cause);
							}
						}
						// Topic 缓存已在上方失效；新会话首包也是新鲜数据。这里若再强刷
						// 目标楼层，会绕过首包中已有的帖子并重复请求同一份 Topic JSON。
						const reopened = await runtime.openTarget({
							topicId,
							...(exactAnchor
								? { postNumber: exactAnchor.viewport.postNumber }
								: {}),
							source: 'restore',
						});
						if (reopened.topic.status === 'failed') {
							const refreshCause = reopened.topic.cause;
							const recovered = await (async () => {
								try {
									await active.services.snapshots
										.persistCurrentSnapshot();
									return await runtime.openTarget({
										topicId,
										...(exactAnchor
											? { postNumber: exactAnchor.viewport.postNumber }
											: {}),
										source: 'restore',
									});
								} catch (recoveryCause) {
									throw new AggregateError(
										[refreshCause, recoveryCause],
										'刷新当前帖子失败，且刷新前内容未能恢复',
									);
								}
							})();
							if (recovered.topic.status === 'failed') {
								throw new AggregateError(
									[refreshCause, recovered.topic.cause],
									'刷新当前帖子失败，且刷新前内容未能恢复',
								);
							}
							if (recovered.topic.status === 'superseded') {
								throw new Error('刷新前内容恢复已被新的打开事务取代');
							}
							if (onlyOpEnabled) {
								recovered.topic.value.topicOnlyOp.setEnabled(true);
							}
							let recoveryMessage =
								'刷新当前帖子失败，已恢复刷新前内容；可稍后再试。';
							if (exactAnchor) {
								try {
									await runtime.historyNavigation.restore(
										topicId,
										exactAnchor,
									);
								} catch {
									recoveryMessage =
										'刷新当前帖子失败，已恢复刷新前内容，但之前的阅读位置未能完整还原。';
								}
							}
							return Object.freeze({
								complete: false,
								restored: true,
								message: recoveryMessage,
							});
						}
						if (reopened.topic.status === 'superseded') {
							throw new Error('当前主题重建已被新的打开事务取代');
						}
						if (onlyOpEnabled) {
							reopened.topic.value.topicOnlyOp.setEnabled(true);
						}
						if (exactAnchor) {
							await runtime.historyNavigation.restore(topicId, exactAnchor);
						}
						return Object.freeze({
							complete: cleanupFailures.length === 0,
							...(cleanupFailures.length
								? {
									message: '当前主题已从原站重新获取，但部分旧缓存未能清理；可再次重试。',
								}
								: {}),
						});
					})();
					currentTopicRefresh = transaction;
					refreshTopicButton.classList.add('is-refreshing');
					refreshTopicButton.setAttribute('aria-busy', 'true');
					syncHeaderTopicActions();
					void transaction.finally(() => {
						if (currentTopicRefresh !== transaction) return;
						currentTopicRefresh = null;
						refreshTopicButton.classList.remove('is-refreshing');
						refreshTopicButton.removeAttribute('aria-busy');
						syncHeaderTopicActions();
					}).catch(() => {});
					return transaction;
				};
				runtime.scope.listen(closeReaderButton, 'click', () => {
					void runtime.close();
				});
				runtime.scope.listen(refreshTopicButton, 'click', (event) => {
					event.preventDefault();
					event.stopPropagation();
					if (refreshTopicButton.disabled) return;
					void refreshCurrentTopic().then((result) => {
						if (!result.complete && result.message) {
							runtime.feedback.show(result.message);
						}
					}).catch((cause) => {
						runtime.feedback.show(
							cause instanceof Error
								? cause.message
								: '刷新当前帖子失败',
						);
					});
				});
				runtime.scope.listen(layoutToggleButton, 'click', () => {
					const mode =
						workspace.workspace.snapshot.presentation.mode;
					workspace.setMode(
						mode === 'fullpage' ? 'floating' : 'fullpage',
					);
				});
				runtime.shell.changes.subscribe(
					syncHeaderTopicActions,
					runtime.scope,
				);
				workspace.workspace.changes.subscribe(
					syncHeaderTopicActions,
					runtime.scope,
				);
				syncHeaderTopicActions();
				const imageProjection = imagePreferences
					? new ReaderImagePreferencesProjection({
						contentRoot: shell.view.root,
						lightboxRoot:
							options.runtime.document.documentElement,
						parentScope: runtime.scope,
					})
					: null;
				if (imageProjection && imagePreferences) {
					const readImageMode = () =>
						readerImagePresentationMode(
							workspace.workspace.snapshot,
						);
					const applyImagePreferences = (): void => {
						imageProjection.applyMode(
							imagePreferences.read(
								context.readPreferences(),
							),
							readImageMode(),
						);
					};
					applyImagePreferences();
					context.preferenceChanges.subscribe((preferences) => {
						imageProjection.applyMode(
							imagePreferences.read(preferences),
							readImageMode(),
						);
					}, runtime.scope);
					workspace.workspace.changes.subscribe(
						applyImagePreferences,
						runtime.scope,
					);
				}
				appearance?.changes.subscribe(() => {
					runtime.shell.activeValue?.dom.notifyScroll();
				}, runtime.scope);
			const readLayoutMode = (): ReaderLayoutMode =>
				workspace.workspace.snapshot.presentation.mode === 'fullpage'
					? 'fullpage'
					: 'standard';
			const layout =
				options.layout
					? new ReaderLayoutStyleController<TPreferences>({
						root: shell.view.root,
						preferences: options.layout,
						readPreferences: context.readPreferences,
						preferenceChanges: context.preferenceChanges,
						mode: {
							read: readLayoutMode,
							subscribe: (listener, scope) =>
								workspace.workspace.changes.subscribe(
									() => listener(readLayoutMode()),
									scope,
								),
						},
						parentScope: runtime.scope,
					})
					: null;
			if (
				options.settings !== false &&
				options.settings !== undefined &&
				!context.updatePreferences
			) {
				runtime.destroy();
				throw new Error(
					'设置 controller 需要 application 唯一偏好写端口',
				);
			}
			const settings =
				options.settings === false || !context.updatePreferences
					? null
					: new ReaderSettingsController<TPreferences>({
						preferences: {
							read: context.readPreferences,
							update: context.updatePreferences,
						},
						...(options.settings?.initialPanelId === undefined
							? {}
							: {
								initialPanelId:
									options.settings.initialPanelId,
							}),
					});
			if (settings) {
				runtime.scope.add(() => settings.destroy());
			}
			const settingsViewOptions =
				options.settings
					? options.settings.view
					: undefined;
			const settingsView =
				settings && settingsViewOptions !== false
					? new ReaderSettingsView<TPreferences>({
						document: options.runtime.document,
						controller: settings,
						feedback: runtime.feedback,
						toggleHost: shell.view.root.querySelector<HTMLElement>(
							'.ldp-head-btns',
						) ?? shell.view.root,
						surfaceHost: shell.view.surfaceHost,
						...(options.runtime.renderIcon
							? { renderIcon: options.runtime.renderIcon }
							: {}),
						...(
							settingsViewOptions?.brandName === undefined
								? {}
								: { brandName: settingsViewOptions.brandName }
						),
						...(
							(settingsViewOptions?.logoUrl ??
								shell.view.root.querySelector<HTMLImageElement>(
									'[data-ldp-site-logo]',
								)?.src) === undefined
								? {}
								: {
									logoUrl:
										settingsViewOptions?.logoUrl ??
										shell.view.root.querySelector<HTMLImageElement>(
											'[data-ldp-site-logo]',
										)!.src,
								}
						),
						parentScope: runtime.scope,
					})
					: null;
			if (settingsView && theme && context.updatePreferences) {
				new ReaderThemeSettingsControl<TPreferences>({
					document: options.runtime.document,
					host: settingsView.themeHost(),
					theme,
					persist: context.updatePreferences,
					...(themeOptions?.hostTheme
						? { hostTheme: themeOptions.hostTheme }
						: {}),
					feedback: runtime.feedback,
					...(options.runtime.renderIcon
						? { renderIcon: options.runtime.renderIcon }
						: {}),
					parentScope: runtime.scope,
				});
			}
			if (settingsView) {
				new ReaderWindowSettingsForm({
					document: options.runtime.document,
					host: settingsView.panelHost('window'),
					workspace,
					parentScope: runtime.scope,
				});
			}
			const sitesFormOptions = options.settings
				? options.settings.sitesForm
				: undefined;
			if (sitesFormOptions && !settingsView) {
				runtime.destroy();
				throw new Error(
					'适用站点 form 需要启用唯一 Settings View',
				);
			}
			if (settingsView && sitesFormOptions) {
				const coordinatedProbe = sitesFormOptions.probe
					? new CoordinatedDiscourseSiteProbe({
						gateway: runtime.data.gateway,
						transport: sitesFormOptions.probe,
					})
					: null;
				new ReaderCustomSiteSettingsForm({
					document: options.runtime.document,
					host: settingsView.panelHost('sites'),
					repository: sitesFormOptions.repository,
					probe: coordinatedProbe,
					parentScope: runtime.scope,
				});
			}
			const aboutContentOptions = options.settings
				? options.settings.aboutContent
				: undefined;
			if (aboutContentOptions && !settingsView) {
				runtime.destroy();
				throw new Error(
					'关于内容需要启用唯一 Settings View',
				);
			}
			if (settingsView && aboutContentOptions) {
				const siteLogo = shell.view.root.querySelector<HTMLImageElement>(
					'[data-ldp-site-logo]',
				)?.src;
				new ReaderAboutSettingsContent({
					document: options.runtime.document,
					host: settingsView.panelHost('about'),
					version: aboutContentOptions.version,
					brandName:
						(settingsViewOptions
							? settingsViewOptions.brandName
							: undefined) ??
						'Awesome LinuxDo Reader',
					...(siteLogo ? { logoUrl: siteLogo } : {}),
					...(aboutContentOptions.manualUrl
						? { manualUrl: aboutContentOptions.manualUrl }
						: {}),
					parentScope: runtime.scope,
				});
			}
			const imageFormOptions = options.settings
				? options.settings.imageForm
				: undefined;
			if (imageFormOptions && !settingsView) {
				runtime.destroy();
				throw new Error(
					'图片设置 form 需要启用唯一 Settings View',
				);
			}
			if (settingsView && imageFormOptions) {
				new ReaderImageSettingsForm<TPreferences>({
					document: options.runtime.document,
					host: settingsView.panelHost('image'),
					controller: settings!,
					preferences: imageFormOptions,
					readPreferences: context.readPreferences,
					preferenceChanges: context.preferenceChanges,
					parentScope: runtime.scope,
				});
			}
			if (settingsView) {
				let settingsUserView: ReaderSettingsUserView | null = null;
				let settingsUsername = '';
				const mountSettingsUser = (): void => {
					const currentUsername = discourseNativeCurrentUsername(
						options.runtime.host,
					).toLocaleLowerCase();
					if (settingsUserView && currentUsername === settingsUsername) return;
					settingsUserView?.destroy();
					settingsUsername = currentUsername;
					settingsUserView = new ReaderSettingsUserView({
						document: options.runtime.document,
						host: settingsView.panelHost('user'),
						session: runtime.users,
						username: currentUsername,
						avatarSource: (template, size) =>
							runtime.userNative.avatarSource(template, size),
							connectEnabled:
								Boolean(options.runtime.connect) &&
								options.runtime.document.location?.hostname === 'linux.do',
							history: runtime.connectHistory,
							creditEnabled:
							options.runtime.document.location?.hostname === 'linux.do',
						...(options.runtime.renderIcon
							? { renderIcon: options.runtime.renderIcon }
							: {}),
						parentScope: runtime.scope,
						onError: (cause) => {
							try {
								options.runtime.onTopicFeatureError?.(Object.freeze({
									topicId: runtime.shell.activeTopicId ?? 0,
									feature: 'user',
									cause,
								}));
							} catch {
								// 用户设置诊断不能破坏 Settings View。
							}
						},
					});
				};
				settingsView.changes.subscribe((snapshot) => {
					if (snapshot.open && snapshot.activePanelId === 'user') {
						mountSettingsUser();
						settingsUserView?.focusConnect();
					}
				}, runtime.scope);
			}
			const performanceFormOptions = options.settings
				? options.settings.performanceForm
				: undefined;
			if (performanceFormOptions && !settingsView) {
				runtime.destroy();
				throw new Error(
					'性能设置 form 需要启用唯一 Settings View',
				);
			}
			if (settingsView && performanceFormOptions) {
				new ReaderPerformanceSettingsForm<TPreferences>({
					document: options.runtime.document,
					host: settingsView.panelHost('performance'),
					controller: settings!,
					preferences: performanceFormOptions,
					readPreferences: context.readPreferences,
					preferenceChanges: context.preferenceChanges,
					parentScope: runtime.scope,
				});
			}
			const readingFormOptions = options.settings
				? options.settings.readingForm
				: undefined;
			if (readingFormOptions && !settingsView) {
				runtime.destroy();
				throw new Error(
					'阅读与导航设置 form 需要启用唯一 Settings View',
				);
			}
			if (settingsView && readingFormOptions) {
				new ReaderReadingSettingsForm<TPreferences>({
					document: options.runtime.document,
					host: settingsView.panelHost('reading'),
					controller: settings!,
					preferences: readingFormOptions,
					readPreferences: context.readPreferences,
					preferenceChanges: context.preferenceChanges,
					parentScope: runtime.scope,
				});
			}
			const translationFormOptions = options.settings
				? options.settings.translationForm
				: undefined;
			if (translationFormOptions && (!settingsView || !runtime.translationRequests)) {
				runtime.destroy();
				throw new Error(
					'翻译与 AI 服务设置 form 需要启用 Settings View 与 TranslationRequestAdapter',
				);
			}
			if (translationFormOptions && runtime.translationRequests) {
				runtime.scope.add(
					translationFormOptions.repository.attachCacheObserver(
						runtime.data.cacheEvents,
					),
				);
				translationFormOptions.repository.metadataChanges.subscribe((cache) => {
					if (!cache) {
						runtime.translationRequests?.clearPublicModelMetadataCache();
					}
				}, runtime.scope);
			}
			if (settingsView && translationFormOptions && runtime.translationRequests) {
				new ReaderTranslationSettingsForm({
					document: options.runtime.document,
					host: settingsView.panelHost('translation'),
					repository: translationFormOptions.repository,
					presentation: translationFormOptions.presentation,
					parentScope: runtime.scope,
				});
				new ReaderAiServiceSettingsForm({
					document: options.runtime.document,
					host: settingsView.panelHost('ai-service'),
					surfaceHost: shell.view.surfaceHost,
					repository: translationFormOptions.repository,
					access: runtime.translationRequests,
					parentScope: runtime.scope,
				});
			}
			const interactionFormOptions = options.settings
				? options.settings.interactionForm
				: undefined;
			if (interactionFormOptions && !settingsView) {
				runtime.destroy();
				throw new Error(
					'帖子与回复设置 form 需要启用唯一 Settings View',
				);
			}
			if (settingsView && interactionFormOptions) {
				const interactionForm = new ReaderInteractionSettingsForm<TPreferences>({
					document: options.runtime.document,
					host: settingsView.panelHost('interaction'),
					controller: settings!,
					boostCopy: interactionFormOptions.boostCopy,
					topicActionRail:
						interactionFormOptions.topicActionRail,
					replyTree: interactionFormOptions.replyTree,
					...(interactionFormOptions.replyTreePreview === undefined
						? {}
						: {
							replyTreePreview:
								interactionFormOptions.replyTreePreview,
						}),
					...(interactionFormOptions.boostsAvailable === undefined
						? {}
						: {
							boostsAvailable:
								interactionFormOptions.boostsAvailable,
						}),
					readPreferences: context.readPreferences,
					preferenceChanges: context.preferenceChanges,
					parentScope: runtime.scope,
				});
				settingsView.changes.subscribe((snapshot) => {
					if (
						snapshot.open &&
						snapshot.activePanelId === 'interaction'
					) {
						interactionForm.refreshCapabilities();
					}
				}, runtime.scope);
			}
			if (settingsView && layout) {
				new ReaderLayoutSettingsForm<TPreferences>({
					document: options.runtime.document,
					host: settingsView.panelHost('layout'),
					controller: settings!,
					layout,
					parentScope: runtime.scope,
				});
			}
			if (settingsView && appearance) {
				new ReaderAppearanceSettingsForm<TPreferences>({
					document: options.runtime.document,
					host: settingsView.panelHost('appearance'),
					controller: settings!,
					appearance,
					parentScope: runtime.scope,
				});
			}
			if (settingsView && font) {
				new ReaderFontSettingsForm<TPreferences>({
					document: options.runtime.document,
					host: settingsView.panelHost('font'),
					controller: settings!,
					font,
					fontCatalog: sharedFontCatalog,
					parentScope: runtime.scope,
				});
			}
			if (
				settingsView &&
				motionPreferences &&
				navigationPreferences
			) {
				new ReaderMotionSettingsForm<TPreferences>({
					document: options.runtime.document,
					host: settingsView.panelHost('flash'),
					controller: settings!,
					navigation: navigationPreferences,
					preferences: motionPreferences,
					readPreferences: context.readPreferences,
					preferenceChanges: context.preferenceChanges,
					parentScope: runtime.scope,
				});
			}
			const webDavOptions = options.settings
				? options.settings.webDav
				: undefined;
			let webDavCoordinator: ReaderWebDavCoordinator | null = null;
			const configuration =
				options.settings && options.settings.configuration
					? options.settings.configuration
					: null;
			const configurationManager = configuration
				? new ReaderSettingsConfigManager<TPreferences>({
					codec: new ReaderSettingsConfigCodec(configuration.codec),
					defaults: configuration.defaults,
					preferences: {
						read: context.readPreferences,
						update: (preferences) => {
							context.updatePreferences!(preferences);
						},
					},
					customSites: configuration.customSites,
					translation: configuration.translation,
					webDav: configuration.webDav,
					...(configuration.prepareResetPreferences
						? {
							prepareResetPreferences:
								configuration.prepareResetPreferences,
						}
						: {}),
				})
				: null;
			const cacheSurface = settingsView
				? new ReaderCacheManagementSurface<TPreferences>({
					document: options.runtime.document,
					host: settingsView.panelHost('cache'),
					...(configurationManager
						? {
							configuration: {
								export: () => configurationManager.export(),
								prepare: (payload: unknown) =>
									configurationManager.prepare(payload),
								apply: (prepared) =>
									configurationManager.apply(prepared),
								reset: async () => {
									const result = await configurationManager.reset();
									requestReaderQueueSurfacePositionsReset(
										options.runtime.document,
									);
									return result;
								},
								confirm: (request) =>
									runtime.feedback.confirm(request),
								saveTextFile: (
									content: string,
									filename: string,
								) => {
									if (!runtime.blobDownloads) {
										throw new Error(
											'浏览器文件下载 capability 不可用',
										);
									}
									runtime.blobDownloads.save(
										new Blob(
											[content],
											{ type: 'application/json' },
										),
										filename,
									);
								},
							},
						}
						: {}),
					history: runtime.history,
					chronicle: runtime.chronicle,
					responses: runtime.data.responses,
					...(runtime.assetCaches
						? { assetCaches: runtime.assetCaches }
						: {}),
					...(webDavOptions
						? {
							prepareClear: async (
								categories: readonly ReaderCacheCategory[],
							) => {
								const {
									webDavCategories,
									protectedCategories,
								} = readerWebDavCacheClearPlan(categories);
								if (!webDavCategories.length) {
									return Object.freeze({
										failed: Object.freeze([]),
									});
								}
								try {
									if (!webDavCoordinator) {
										throw new Error('WebDAV 同步协调器尚未就绪');
									}
									const release = await webDavCoordinator
										.acquireLocalCacheClear(webDavCategories);
									return Object.freeze({
										failed: Object.freeze([]),
										release,
									});
								} catch (cause) {
									reportCacheError(cause);
									return Object.freeze({
										failed: Object.freeze(protectedCategories),
									});
								}
							},
						}
						: {}),
					applicationCaches: {
						stats: async () => {
							const users = runtime.users.cacheStats();
							const userObservations = runtime.userObservations.cacheStats();
							const notifications = runtime.notificationController
								?.cacheStats() ?? { pages: 0, records: 0 };
							const bookmarks = runtime.bookmarkController
								?.cacheStats() ?? {
									bookmarks: 0,
									reactions: 0,
									boosts: 0,
									replies: 0,
								};
							const publicModelMetadata = translationFormOptions
								? await translationFormOptions.repository
									.loadModelMetadataCache()
								: null;
							const creditBridge = await runtime.creditAccount?.cacheStats() ?? {
								records: 0,
								bytes: 0,
								cachedAt: null,
								expired: false,
							};
							const imageObjects = runtime.imageResources?.diagnostics() ?? {
								objectUrls: 0,
								objectUrlLimit: 0,
							};
							const hostIdentity = readerTopicHostIdentityCacheStats(
								options.runtime.document,
							);
							return Object.freeze({
								categories: Object.freeze({
									topics: Object.freeze({
										records: (runtime.shell.activeValue ? 1 : 0) +
											hostIdentity.categoryEntries + hostIdentity.tagEntries,
										detail: runtime.shell.activeTopicId === null
											? `当前会话：未打开主题；宿主身份派生：` +
												`${hostIdentity.categoryEntries} 个分类键 · ` +
												`${hostIdentity.tagEntries} 个标签`
											: `当前会话：主题 ${runtime.shell.activeTopicId}（清理时联网重建）；` +
												`宿主身份派生：${hostIdentity.categoryEntries} 个分类键 · ` +
												`${hostIdentity.tagEntries} 个标签`,
									}),
								users: Object.freeze({
									records: users.profiles + users.followLists +
										users.externalSnapshots + creditBridge.records +
										userObservations.storedRecords,
									detail: `内存热缓存：${users.profiles} 个资料 · ` +
										`${users.followLists} 份关注列表 · ` +
										`${users.externalSnapshots} 份账户摘要；` +
										`用户观察：${userObservations.users} 人 · ` +
										`${userObservations.memoryRecords} 条内存 / ` +
										`${userObservations.storedRecords} 条持久投影；` +
										`LDC bridge ${creditBridge.records} 条（${creditBridge.bytes} B）`,
									}),
									notifications: Object.freeze({
										records: notifications.records,
										detail: `内存热缓存：${notifications.pages} 页 · ` +
											`${notifications.records} 条消息`,
									}),
								responses: Object.freeze({
									records: bookmarks.bookmarks + bookmarks.reactions +
										bookmarks.boosts + bookmarks.replies +
										(publicModelMetadata ? 1 : 0),
									detail: `内存热缓存：${bookmarks.bookmarks} 条收藏 · ` +
										`${bookmarks.reactions} 条回应 · ` +
										`${bookmarks.boosts} 条 Boost · ` +
										`${bookmarks.replies} 条回复；` +
										`公共模型元数据：${publicModelMetadata?.catalog.length ?? 0} 个模型`,
									}),
									assets: Object.freeze({
										records: imageObjects.objectUrls,
										detail: `内存对象 URL：${imageObjects.objectUrls} / ` +
											`${imageObjects.objectUrlLimit}`,
									}),
								}),
							});
						},
						clear: async (categories) => {
							const selected = new Set(categories);
							const failed: ReaderCacheCategory[] = [];
							const resumes: Array<() => void> = [];
							if (selected.has('users')) {
								try {
									runtime.users.clearCache();
									runtime.userObservations.clearCache();
									await runtime.creditAccount?.clearCache();
								} catch (cause) {
									failed.push('users');
									reportCacheError(cause);
								}
							}
							if (selected.has('notifications')) {
								try {
									if (runtime.notificationController) {
										runtime.notificationController.clearCache({ resume: false });
										resumes.push(() =>
											runtime.notificationController?.startBackgroundCache());
									}
								} catch (cause) {
									failed.push('notifications');
									reportCacheError(cause);
								}
							}
							if (selected.has('responses')) {
								try {
									if (runtime.bookmarkController) {
										runtime.bookmarkController.clearCache({ resume: false });
										resumes.push(() =>
											runtime.bookmarkController?.startBackgroundCache());
									}
									if (translationFormOptions) {
										await translationFormOptions.repository
											.clearModelMetadataCache();
									}
								} catch (cause) {
									failed.push('responses');
									reportCacheError(cause);
								}
							}
							if (selected.has('topics')) {
								try {
									if (runtime.shell.activeValue) {
										const result = await refreshCurrentTopic({
											clearImages: false,
										});
										if (!result.complete) failed.push('topics');
									}
								} catch (cause) {
									failed.push('topics');
									reportCacheError(cause);
								} finally {
									clearReaderTopicHostIdentityCache(
										options.runtime.document,
									);
								}
							}
							return Object.freeze({
								failed: Object.freeze(failed),
								...(resumes.length
									? {
										resume: () => {
											for (const resume of resumes) resume();
										},
									}
									: {}),
							});
						},
					},
					clearImageObjectUrls: () =>
						runtime.imageResources?.clearObjectUrls(),
					cacheLog: runtime.data.cacheEvents,
					...(runtime.blobDownloads
						? {
							saveCacheLog: (content: string, filename: string) => {
								runtime.blobDownloads!.save(
									new Blob([content], {
										type: 'application/x-ndjson;charset=utf-8',
									}),
									filename,
								);
							},
						}
						: {}),
					currentTopicAvailable: () =>
						runtime.shell.activeTopicId !== null,
					clearCurrentTopic: () => refreshCurrentTopic(),
					notify: (message) => runtime.feedback.show(message),
					onError: reportCacheError,
					parentScope: runtime.scope,
				})
				: null;
			if (cacheSurface) {
				runtime.shell.changes.subscribe(
					() => cacheSurface.sync(),
					runtime.scope,
				);
				let cachePanelVisible = false;
				settingsView?.changes.subscribe((snapshot) => {
					const visible = snapshot.open && snapshot.activePanelId === 'cache';
					if (visible && !cachePanelVisible) void cacheSurface.refresh();
					cachePanelVisible = visible;
				}, runtime.scope);
			}
			const resourceMonitor = settingsView
				? new ReaderResourceMonitor({
					document: options.runtime.document,
					host: settingsView.panelHost('logs'),
					readerRoot: shell.view.root,
					requests: runtime.data.requests,
					schedulerSnapshot: () =>
						runtime.data.client.scheduler.snapshot(),
					permitSnapshot: () => runtime.permit.snapshot(),
					performancePolicySnapshot: () => runtime.performance,
					topicSnapshot: () => {
							const active = runtime.shell.activeValue;
							const session = active?.services.session;
							const coverage = session?.postStreamCoverage();
							const unavailableFloors =
								session?.unavailablePostNumbers() ??
								Object.freeze([]);
							const unavailableSet = new Set<number>(
								unavailableFloors,
							);
							const relations =
								active?.replies.topology.snapshot().relations ??
								[];
							const views =
								active?.dom.domOwner.views() ?? [];
							const mountedViews = views.filter(
								(view) => view.slots.root.isConnected,
							);
							const roots = mountedViews.map(
								(view) => view.slots.root,
							);
							const imageCatalog =
								active?.topicImages.snapshot();
							const imageRetry =
								active?.topicMedia.images.diagnostics();
							const mediaRuntime =
								active?.topicMedia.media.diagnostics();
							const imageResources =
								runtime.imageResources?.diagnostics();
							const hlsSources = roots.reduce(
								(total, root) =>
									total + [
										...root.querySelectorAll<HTMLVideoElement>(
											'video',
										),
									].filter((video) =>
										readerHlsSource(
											video,
											options.runtime.document.baseURI,
										),
									).length,
								0,
							);
							const nativeHlsSources = roots.reduce(
								(total, root) =>
									total + [
										...root.querySelectorAll<HTMLVideoElement>(
											'video',
										),
									].filter((video) => {
										if (!readerHlsSource(
											video,
											options.runtime.document.baseURI,
										)) return false;
										try {
											return Boolean(video.canPlayType(
												'application/vnd.apple.mpegurl',
											)) && mediaRuntime?.nativeManagedMediaSource === true;
										} catch {
											return false;
										}
									}).length,
								0,
							);
							return Object.freeze({
								topicId: runtime.shell.activeTopicId,
								mountedFloors: mountedViews.length,
								preparedFloors:
									active?.dom.preparedPostViewCount ??
									views.length,
								retainedFloors:
									session?.cachedPosts().length ?? 0,
							nestedFloors: relations.filter(
								(relation) =>
										relation.parentPostNumber !== null,
								).length,
								media: roots.reduce(
									(total, root) =>
										total + root.querySelectorAll(
										'img,video,audio,iframe',
										).length,
									0,
								),
								initializedFromCache:
									session?.initializedFromCache ?? false,
							expectedFloors:
								coverage?.expectedPostCount ?? 0,
							streamFloors:
								coverage?.streamPostCount ?? 0,
								missingFloors:
									coverage?.missingPostCount ?? 0,
								unavailableFloors,
								mediaDiagnostics: Object.freeze({
									catalogImages:
										imageCatalog?.items.length ?? 0,
									catalogComplete:
										imageCatalog?.complete ?? false,
									catalogPending:
										imageCatalog?.pending ?? false,
									catalogFailedBatches:
										imageCatalog?.failedBatchCount ?? 0,
									persistentCacheEnabled:
										runtime.imageResources !== null,
									objectUrls:
										imageResources?.objectUrls ?? 0,
									objectUrlLimit:
										imageResources?.objectUrlLimit ?? 0,
									boundImages:
										imageRetry?.boundImages ?? 0,
									failedImages:
										imageRetry?.failedImages ?? 0,
									retryingImages:
										imageRetry?.retryingImages ?? 0,
									crossOriginFailures:
										imageRetry?.crossOriginFailures ?? 0,
									failedPostNumbers:
										imageRetry?.failedPostNumbers ??
										Object.freeze([]),
									unavailableSourcePostNumbers:
										Object.freeze([
											...new Set(
												(imageCatalog?.items ?? [])
													.map(
														(item) =>
															item.sourcePostNumber,
													)
													.filter(
														(postNumber) =>
															unavailableSet.has(
																postNumber,
															),
													),
											),
										].sort((left, right) => left - right)),
									hlsSources,
									nativeHlsSources,
									activeHlsPlayers:
										mediaRuntime?.activeHlsPlayers ?? 0,
									hlsLibraryAvailable:
										mediaRuntime?.hlsLibraryAvailable ??
										false,
									hlsLibrarySupported:
										mediaRuntime?.hlsLibrarySupported ??
										false,
									nativeManagedMediaSource:
										mediaRuntime
											?.nativeManagedMediaSource ??
										false,
								}),
							});
					},
					performance:
						options.runtime.document.defaultView?.performance ??
						null,
					parentScope: runtime.scope,
				})
				: null;
			if (settingsView && resourceMonitor) {
				const syncResourceMonitor = (): void => {
					const snapshot = settingsView.snapshot;
					if (
						snapshot.open &&
						snapshot.activePanelId === 'logs'
					) {
						resourceMonitor.start();
					} else {
						resourceMonitor.stop();
					}
				};
				settingsView.changes.subscribe(
					syncResourceMonitor,
					runtime.scope,
				);
				syncResourceMonitor();
			}
			const queuePreferences = options.openQueue || null;
			if (queuePreferences && !context.updatePreferences) {
				runtime.destroy();
				throw new Error(
					'阅读队列与退出策略需要 application 唯一偏好写端口',
				);
			}
			if (queuePreferences) {
				runtime.composer.installCloseGuard({
					document: options.runtime.document,
					enabled: () =>
						queuePreferences.read(
							context.readPreferences(),
						).confirmNativeComposerClose,
					notify: (message) => runtime.feedback.show(message),
					parentScope: runtime.scope,
				});
			}
			const queuePrefetchForegroundBusy = (): boolean => {
				if (options.runtime.document.visibilityState !== 'visible') return true;
				if (
					runtime.shell.state === 'opening' ||
					runtime.shell.state === 'switching'
				) return true;
				const lastScrollAt = runtime.shell.activeValue?.dom.lastUserScrollAt() ?? 0;
				const now = options.runtime.document.defaultView?.performance.now() ??
					performance.now();
				return lastScrollAt > 0 && now - lastScrollAt < 700;
			};
				const waitForQueuePrefetchIdle = async (
					signal: AbortSignal,
				): Promise<void> => {
				while (!signal.aborted && queuePrefetchForegroundBusy()) {
					await abortableDelay(180, signal);
				}
					if (signal.aborted) throw signal.reason;
				};
				const waitForQueuePrefetchRequestHeadroom = async (
					signal: AbortSignal,
				): Promise<void> => {
					while (!signal.aborted) {
						await waitForQueuePrefetchIdle(signal);
						const snapshot = await runtime.permit.snapshot();
						if (
							snapshot.challengeState === 'idle' &&
							readerQueuePrefetchRequestHasHeadroom(snapshot)
						) return;
						const delayMs = snapshot.nextPermitDelay > 0
							? Math.max(500, Math.min(2_000, snapshot.nextPermitDelay))
							: 1_000;
						await abortableDelay(delayMs, signal);
					}
					throw signal.reason;
				};
			const waitForTopicDownloadIdle = async (
				signal: AbortSignal,
			): Promise<void> => {
				while (
					!signal.aborted &&
					options.runtime.document.visibilityState === 'visible' &&
					queuePrefetchForegroundBusy()
				) {
					await abortableDelay(180, signal);
				}
				if (signal.aborted) throw signal.reason;
			};
			const waitForTopicDownloadRequestHeadroom = async (
				signal: AbortSignal,
				nestedReplies = false,
			): Promise<void> => {
				while (!signal.aborted) {
					await waitForTopicDownloadIdle(signal);
					const snapshot = await runtime.permit.snapshot();
					if (
						snapshot.challengeState === 'idle' &&
						readerBulkBackgroundRequestHasHeadroom(snapshot, nestedReplies)
					) return;
					const delayMs = snapshot.nextPermitDelay > 0
						? Math.max(180, Math.min(1_000, snapshot.nextPermitDelay))
						: 360;
					await abortableDelay(delayMs, signal);
				}
				throw signal.reason;
			};
			const topicDownloadRequestMustPause = (error: unknown): boolean =>
				runtime.data.client.requestResume(error) !== null;
			const queueTopicPresentation = queuePreferences
				? discourseNativeTopicPresentation(options.runtime.host)
				: null;
			const topicOfflineArtifacts = runtime.blobDownloads
				? new ReaderTopicOfflineArtifactRepository(
					runtime.data.responses,
					options.runtime.topic.authScope,
				)
				: null;
			const topicDownloadQuoteEndpointPreferences = new Map<number, string>();
			const topicDownloadUnavailableQuoteTargets = new Set<string>();
			const openQueue = queuePreferences
				? new ReaderOpenQueueSession({
					document: options.runtime.document,
					root: shell.view.modal,
					workspaceRoot: shell.view.root,
					storage: options.runtime.storage,
					authScope: options.runtime.topic.authScope,
					target: runtime,
					currentTopicId: () => runtime.shell.activeTopicId,
					readerOpen: () => [
						'opening',
						'switching',
						'running',
						'failed',
					].includes(runtime.shell.state),
					historyEntry: (topicId) => topicId
						? runtime.history.entry(topicId)
						: runtime.history.ordered('recent-viewed')[0] ?? null,
					avatarSource: (template, size) =>
						queueTopicPresentation?.avatarSource(template, size) ?? '',
					emojiSource: (id) =>
						queueTopicPresentation?.emojiSource?.(id) ?? '',
					historyAnchor: (topicId) => {
						const activeAnchor =
							runtime.historyNavigation.snapshot.states[
								String(topicId)
							];
						if (activeAnchor) return activeAnchor;
						const viewport = runtime.history.entry(topicId)?.viewport ?? null;
						return viewport === null
							? null
							: normalizeReaderHistoryAnchorState({ viewport });
					},
					restoreHistoryAnchor: async (topicId, anchor) => {
						await runtime.historyNavigation.restore(topicId, anchor, {
							highlight: false,
							restoreSemanticState: false,
						});
					},
					prefetch: async (topicId, postNumber, signal, report) => {
						const scope = runtime.scope.child();
						const abort = scope.abortController(
							new DOMException('阅读队列预加载已释放', 'AbortError'),
							signal,
						);
						const bundle = runtime.data.createTopicBundle<
							TTopic,
							TPost
						>({
							topicId,
							scope,
							signal: abort.signal,
							mount: () => () => {},
						}, {
							...options.runtime.topic,
							host: options.runtime.host,
							nativeAjax: runtime.nativeAjax,
						});
						try {
							await abortableDelay(900, abort.signal);
							await waitForQueuePrefetchRequestHeadroom(abort.signal);
							await bundle.services.session.init({ background: true });
							const session = bundle.services.session;
							const stream = [...session.streamPostIds()];
							const targetPost = postNumber
								? session.postByNumber(postNumber)
								: undefined;
							const targetPostId = Number(
								(targetPost as { id?: unknown } | undefined)?.id,
							);
							const foundIndex = targetPostId
								? stream.findIndex((postId) => Number(postId) === targetPostId)
								: -1;
							const targetIndex = foundIndex >= 0
								? foundIndex
								: Math.max(
									0,
									Math.min(stream.length - 1, Number(postNumber ?? 1) - 1),
								);
							let ids = stream;
							if (stream.length > 200 && Number(postNumber ?? 1) > 1) {
								const before = Math.min(targetIndex, 100);
								let start = Math.max(0, targetIndex - before);
								let end = Math.min(stream.length, targetIndex + 200 - before);
								start = Math.max(0, end - 200);
								end = Math.min(stream.length, start + 200);
								ids = stream.slice(start, end);
							} else if (stream.length > 200 && targetIndex > 0) {
								const headCount = 40;
								const localBudget = 160;
								const before = Math.min(targetIndex, 80);
								let localStart = Math.max(0, targetIndex - before);
								let localEnd = Math.min(
									stream.length,
									localStart + localBudget,
								);
								localStart = Math.max(0, localEnd - localBudget);
								const selected = new Set(stream.slice(0, headCount));
								stream.slice(localStart, localEnd).forEach((id) => selected.add(id));
								if (selected.size < 200) {
									stream.slice(localEnd, localEnd + 200 - selected.size)
										.forEach((id) => selected.add(id));
								}
								ids = [...selected].slice(0, 200);
							} else if (stream.length > 200) {
								ids = stream.slice(0, 200);
							}
							let loadedCount = stream.reduce(
								(count, postId) => count + Number(Boolean(
									session.postById(Number(postId)),
								)),
								0,
							);
							for (
								let offset = 0;
								offset < ids.length;
								offset += session.pageSize
							) {
								const batch = ids.slice(offset, offset + session.pageSize);
								const loadedBefore = batch.reduce(
									(count, postId) => count + Number(Boolean(
										session.postById(Number(postId)),
									)),
									0,
								);
								await session.loadPostsByIds(
									batch,
									{
										background: true,
										maxAttempts: 1,
										/*
										 * TopicSession 只在 canonical 缓存与在飞单飞
										 * 都未命中时调用 beforeNetwork。额度等待必须
										 * 放在这个真实缺口边界，不能阻塞纯缓存
										 * 队列或重复消费者加入已有请求。
										 */
										beforeNetwork: () =>
											waitForQueuePrefetchRequestHeadroom(abort.signal),
									},
								);
								const loadedAfter = batch.reduce(
									(count, postId) => count + Number(Boolean(
										session.postById(Number(postId)),
									)),
									0,
								);
								loadedCount += loadedAfter - loadedBefore;
								report({
									loadedCount,
									totalCount: stream.length,
								});
							}
							const nested = await session.loadReplyBranches(
								ids.map((postId) => Number(
									session.postById(Number(postId))?.post_number ?? 0,
								)).filter((postNumber) =>
									Number.isSafeInteger(postNumber) && postNumber > 0),
								{
									background: true,
									maxPages: 32,
									maxAttempts: 2,
									beforePage: () =>
										waitForQueuePrefetchRequestHeadroom(abort.signal),
								},
							);
							report({
								nestedLoadedCount: nested.loadedReplyCount,
								nestedTotalCount: nested.expectedReplyCount,
							});
							const topic = session.topic;
							const mediaPosts = nested.postNumbers
								.map((childPostNumber) =>
									session.postByNumber(childPostNumber))
								.filter((post): post is TPost => post !== undefined);
							const media = runtime.mediaPrefetch
								? await runtime.mediaPrefetch.prefetch({
									posts: mediaPosts,
									signal: abort.signal,
									waitUntilIdle: waitForQueuePrefetchRequestHeadroom,
									reactionSources: (post) => topic
										? runtime.postReactions.options(topic, post)
											.flatMap((option) => option.imageUrl
												? [option.imageUrl]
												: [])
										: [],
									onProgress: (progress) => report({
										mediaLoadedCount: progress.loadedCount,
										mediaTotalCount: progress.totalCount,
									}),
								})
								: Object.freeze({
									loadedCount: 0,
									totalCount: 0,
									failedCount: 0,
									complete: true,
								});
							await session.flush();
							loadedCount = stream.reduce(
								(count, postId) => count + Number(Boolean(
									session.postById(Number(postId)),
								)),
								0,
							);
							return Object.freeze({
								loadedCount,
								totalCount: stream.length,
								nestedLoadedCount: nested.loadedReplyCount,
								nestedTotalCount: nested.expectedReplyCount,
								mediaLoadedCount: media.loadedCount,
								mediaTotalCount: media.totalCount,
								complete: loadedCount >= stream.length &&
									nested.complete &&
									media.complete,
							});
						} finally {
							await bundle.prepareClose?.('close');
							scope.destroy();
						}
					},
					...(runtime.blobDownloads
						? {
								topicDownloads: {
									downloads: runtime.blobDownloads,
									requestResume: (error) =>
										runtime.data.client.requestResume(error),
									mount: shell.view.surfaceHost,
									floating: true,
									confirmRemoval: async (context, host) => {
										const requestedAt = Number(
											context.localDownloadRequestedAt,
										);
										const localDownload = requestedAt > 0
											? `曾于 ${new Date(requestedAt).toLocaleString(
												'zh-CN',
											)} 触发浏览器下载`
											: 'Reader 未记录曾触发本地下载';
										const choice = await runtime.feedback.choose({
											title: '移除 Topic 下载记录？',
											message: context.hasCachedHtml
												? '请选择是否同时删除 Reader 缓存中的离线 HTML。'
												: '该记录没有可清理的 Reader 缓存 HTML。',
											details: Object.freeze([
												Object.freeze({
													label: 'Reader 缓存 HTML',
													value: context.hasCachedHtml ? '已保存' : '未找到',
												}),
												Object.freeze({
													label: '本地下载',
													value: localDownload,
												}),
												...(context.filename
													? [Object.freeze({
														label: '文件名',
														value: context.filename,
													})]
													: []),
											]),
											note: '受浏览器安全限制，Reader 无法检查本地文件是否仍存在，' +
												'也无法删除下载目录中的文件；如需删除请手动处理。',
											cancelLabel: '取消',
											...(context.hasCachedHtml
												? { secondaryLabel: '仅移除记录' }
												: {}),
											confirmLabel: context.hasCachedHtml
												? '记录和缓存都删除'
												: '移除记录',
											icon: 'trash',
										}, host);
										if (choice === 'confirm') return 'remove-record-and-cache';
										if (choice === 'secondary') return 'remove-record';
										return 'cancel';
									},
									confirmBulkRemoval: async (contexts, host) => {
										const cachedCount = contexts.filter((context) =>
											context.hasCachedHtml).length;
										const downloadedCount = contexts.filter((context) =>
											context.localDownloadRequestedAt > 0).length;
										const choice = await runtime.feedback.choose({
											title: `移除 ${contexts.length} 条 Topic 下载记录？`,
											message: cachedCount
												? '请选择是否同时删除这些记录在 Reader 中缓存的离线 HTML。'
												: '所选记录没有可清理的 Reader 缓存 HTML。',
											details: Object.freeze([
												Object.freeze({
													label: '下载记录',
													value: `${contexts.length} 条`,
												}),
												Object.freeze({
													label: 'Reader 缓存 HTML',
													value: `${cachedCount} 份`,
												}),
												Object.freeze({
													label: '曾触发本地下载',
													value: `${downloadedCount} 条`,
												}),
											]),
											note: 'Reader 无法检查或删除下载目录中的本地文件；' +
												'如需删除，请在文件管理器中手动处理。',
											cancelLabel: '取消',
											...(cachedCount > 0
												? { secondaryLabel: '仅移除记录' }
												: {}),
											confirmLabel: cachedCount > 0
												? '记录和缓存都删除'
												: '移除记录',
											icon: 'trash',
										}, host);
										if (choice === 'confirm') return 'remove-record-and-cache';
										if (choice === 'secondary') return 'remove-record';
										return 'cancel';
									},
									hydrateHtmlWindow:
										hydrateReaderTopicOfflineDocumentWindow,
									...(topicOfflineArtifacts
										? { artifacts: topicOfflineArtifacts }
										: {}),
									worker: async (
										topicId,
										fallbackTitle,
										signal,
										report,
										selection,
									) => {
										const scope = runtime.scope.child();
						const abort = scope.abortController(
							new DOMException('Topic 后台下载已释放', 'AbortError'),
							signal,
						);
						let backgroundNetworkRequestCount = 0;
						async function beforeDownloadNetwork(
							networkSignal: AbortSignal,
							nestedReplies = false,
						): Promise<void> {
							await waitForTopicDownloadRequestHeadroom(
								networkSignal,
								nestedReplies,
							);
							backgroundNetworkRequestCount += 1;
						}
						const bundle = runtime.data.createTopicBundle<TTopic, TPost>({
										topicId,
										scope,
										signal: abort.signal,
										mount: () => () => {},
									}, {
										...options.runtime.topic,
										host: options.runtime.host,
										nativeAjax: runtime.nativeAjax,
										});
										try {
							report({
								phase: 'loading-topic',
								detail: '正在读取 Topic 与本地存档',
							});
							await waitForTopicDownloadIdle(abort.signal);
							const topic = await bundle.services.session.init({
								background: true,
								beforeNetwork: beforeDownloadNetwork,
							});
										const session = bundle.services.session;
										const cachedAtStart = session.cachedPosts();
										const streamCoverageAtStart = session.postStreamCoverage();
										const archiveAtStart = session.localArchiveState();
										const localArchivePlan = readerTopicDownloadLocalArchivePlan({
											topicStatus: archiveAtStart.topic?.status,
											cachedPostCount: cachedAtStart.length,
											expectedPostCount: streamCoverageAtStart.expectedPostCount,
											streamPostCount: streamCoverageAtStart.streamPostCount,
											missingStreamPostCount: streamCoverageAtStart.missingPostCount,
											streamComplete: streamCoverageAtStart.complete,
										});
										let streamComplete = false;
										let missingCanonicalPostCount = 0;
										let repliesComplete = false;
										if (localArchivePlan) {
											streamComplete = localArchivePlan.streamComplete;
											missingCanonicalPostCount =
												localArchivePlan.missingCanonicalPostCount;
											report({
												phase: 'loading-replies',
												completed: localArchivePlan.completed,
												total: localArchivePlan.total,
												detail:
													`正在整理 ${archiveAtStart.topic?.status ?? 404} 本地缓存 ` +
													`${localArchivePlan.completed}/${localArchivePlan.total}`,
											});
										} else {
								const stream = await session.ensurePostStream({
									background: true,
									maxAttempts: 2,
									beforeNetwork: beforeDownloadNetwork,
									beforeBatch: () =>
										waitForTopicDownloadIdle(abort.signal),
												onProgress: (progress) => report({
													phase: 'loading-posts',
													completed: progress.loadedCount,
													total: progress.totalCount,
													detail:
														`正文已就绪 ${progress.loadedCount}/` +
														`${progress.totalCount || '?'} · 本轮复用缓存 ` +
														`${Math.min(cachedAtStart.length, progress.loadedCount)} · ` +
														`后台联网 ${backgroundNetworkRequestCount}`,
												}),
											});
											streamComplete = stream.complete;
											missingCanonicalPostCount = stream.missingPostIds.length;
											const canonicalPosts = session.cachedPosts();
											report({
												phase: 'loading-replies',
												completed: canonicalPosts.length,
												total: canonicalPosts.length,
												detail:
													`已从 canonical 正文整理回复关系 ` +
													`${canonicalPosts.length}/${canonicalPosts.length} · ` +
													`后台联网 ${backgroundNetworkRequestCount}`,
											});
											/*
											 * 完整 post_stream 已包含当前账号可见的全部楼层以及
											 * reply_to_post_number。离线文档直接用这组 canonical 字段建树；
											 * 此处再逐父楼请求 direct-replies 只会重复传输同一批正文，且大帖
											 * 会迅速把 /posts/:id/replies.json 顶到 429。正常阅读和讨论浮窗的
											 * 按需补齐仍由 TopicSession 负责，下载快速路径不再重复联网。
											 */
											repliesComplete = stream.complete;
										}
										const topicRecord = topic as Readonly<Record<string, unknown>>;
										const specialContentWarnings: string[] = [];
										if (topicRecord.is_post_voting === true && !localArchivePlan) {
											const record = (
												value: unknown,
											): Readonly<Record<string, unknown>> | null =>
												value !== null && typeof value === 'object' &&
												!Array.isArray(value)
													? value as Readonly<Record<string, unknown>>
													: null;
											const votingPosts = session.cachedPosts().filter((post) => {
												const source = post as Readonly<Record<string, unknown>>;
												const loaded = Array.isArray(source.post_voting_comments)
													? source.post_voting_comments.length
													: Array.isArray(source.comments)
														? source.comments.length
														: 0;
												return Math.max(0, Number(source.comments_count) || 0) > loaded;
											});
											for (const [postIndex, post] of votingPosts.entries()) {
												const source = post as Readonly<Record<string, unknown>>;
												const postId = Number(source.id);
												const postNumber = Number(source.post_number);
												const expectedComments = Math.max(
													0,
													Number(source.comments_count) || 0,
												);
												if (!Number.isSafeInteger(postId) || postId < 1) continue;
												const current = Array.isArray(source.post_voting_comments)
													? source.post_voting_comments
													: Array.isArray(source.comments) ? source.comments : [];
												const merged = new Map<number, Readonly<Record<string, unknown>>>();
												for (const value of current) {
													const candidate = record(value);
													const id = Number(candidate?.id);
													if (candidate && Number.isSafeInteger(id) && id > 0) {
														merged.set(id, Object.freeze({ ...candidate }));
													}
												}
												try {
													let pages = 0;
													while (merged.size < expectedComments && pages < 100) {
														pages += 1;
														await waitForTopicDownloadIdle(abort.signal);
														report({
															phase: 'loading-replies',
															completed: postIndex,
															total: votingPosts.length,
															detail:
																`正在补齐楼层 #${postNumber} 的投票评论 · ` +
																`后台联网 ${backgroundNetworkRequestCount}`,
														});
														const afterCommentId = Math.max(0, ...merged.keys());
														const payload = await bundle.services.requests
															.loadPostVotingComments<unknown>(postId, {
																afterCommentId,
																refresh: true,
																background: true,
																beforeNetwork: beforeDownloadNetwork,
															});
														const payloadRecord = record(payload);
														const incoming = Array.isArray(payload)
															? payload
															: Array.isArray(payloadRecord?.comments)
																? payloadRecord.comments
																: [];
														let added = 0;
														for (const value of incoming) {
															const candidate = record(value);
															const id = Number(candidate?.id);
															if (
																candidate && Number.isSafeInteger(id) && id > 0 &&
																!merged.has(id)
															) added += 1;
															if (candidate && Number.isSafeInteger(id) && id > 0) {
																merged.set(id, Object.freeze({ ...candidate }));
															}
														}
														if (!added) break;
													}
													session.ingestPosts([Object.freeze({
														...source,
														post_voting_comments: Object.freeze([...merged.values()]),
													}) as unknown as TPost], 'action-response');
													if (merged.size < expectedComments) {
														specialContentWarnings.push(
															`楼层 #${postNumber} 投票评论仅保存 ` +
															`${merged.size}/${expectedComments}`,
														);
													}
												} catch (error) {
													if (topicDownloadRequestMustPause(error)) throw error;
													specialContentWarnings.push(
														`楼层 #${postNumber} 投票评论未能补齐`,
													);
												}
											}
										}
										const archive = session.localArchiveState();
										const archived = archive.topic !== null || archive.posts.length > 0;
										const coverage = readerTopicDownloadCoverage({
											selectionMode: selection.mode,
											streamComplete,
											missingCanonicalPostCount,
											repliesComplete,
											archived,
										});
										await session.flush();
										const availablePosts = session.cachedPosts();
										const selected = selectReaderTopicDownloadPosts(
											availablePosts,
											selection,
											selection.mode === 'op'
												? readerTopicOwnerUsername(topic, availablePosts)
												: '',
										);
										const contextPosts = selected.posts;
										const contextPostNumbers = new Set(contextPosts.map((post) =>
											Number(post.post_number)));
										const availablePostByNumber = new Map(availablePosts.map((post) =>
											[Number(post.post_number), post] as const));
										const quotedPosts = new Map<string, Readonly<{
											readonly topicId: number;
											readonly post: TPost;
										}>>();
										const quotePayloadPosts = new Map<string, TPost>();
											const quoteTargets = readerTopicOfflineQuoteTargets(
											options.runtime.document,
											Number(topicId),
											contextPosts,
											);
											let missingQuoteTargetCount = 0;
											for (const [quoteIndex, target] of quoteTargets.entries()) {
											if (
													target.topicId === Number(topicId) &&
													contextPostNumbers.has(target.postNumber)
												) continue;
												const quoteKey = `${target.topicId}:${target.postNumber}`;
												if (
													target.topicId === Number(topicId) &&
													streamComplete &&
													missingCanonicalPostCount === 0 &&
													!availablePostByNumber.has(target.postNumber)
												) {
													missingQuoteTargetCount += 1;
													continue;
												}
												report({
												phase: 'loading-replies',
												completed: quoteIndex,
												total: quoteTargets.length,
												detail:
													`正在补齐引用正文 ${quoteIndex + 1}/${quoteTargets.length} · ` +
													`后台联网 ${backgroundNetworkRequestCount}`,
											});
												let quotedPost = target.topicId === Number(topicId)
												? availablePostByNumber.get(target.postNumber) ?? null
												: quotePayloadPosts.get(quoteKey) ?? null;
												if (
													!quotedPost &&
													!localArchivePlan &&
													!topicDownloadUnavailableQuoteTargets.has(quoteKey)
												) {
												await waitForTopicDownloadIdle(abort.signal);
												const targetOptions = {
													scope: 'single' as const,
													background: true,
													beforeNetwork: beforeDownloadNetwork,
												};
												const candidates = prioritizeReaderTopicOfflineTargetCandidates(
													bundle.services.requests.targetCandidates(
														target.postNumber,
														targetOptions,
														target.topicId,
													),
													topicDownloadQuoteEndpointPreferences.get(target.topicId),
												);
												for (const candidate of candidates) {
													try {
														const payload = await bundle.services.requests
															.loadTargetCandidate<unknown>(
																candidate,
																target.postNumber,
											targetOptions,
											target.topicId,
										);
														for (const post of discoursePostsFromPayload<TPost>(payload)) {
															const postNumber = Number(post.post_number);
															if (!Number.isSafeInteger(postNumber) || postNumber < 1) continue;
															quotePayloadPosts.set(
																`${target.topicId}:${postNumber}`,
																post,
															);
														}
														quotedPost = quotePayloadPosts.get(quoteKey) ?? null;
														if (quotedPost) {
															topicDownloadQuoteEndpointPreferences.set(
																target.topicId,
																candidate.endpoint,
															);
															break;
														}
													} catch (error) {
														if (
															error instanceof DOMException &&
															error.name === 'AbortError'
														) throw error;
														if (topicDownloadRequestMustPause(error)) throw error;
															const status = Number(
																(error as { readonly status?: unknown })?.status,
															);
															if (discourseNativeTargetFailureIsDefinitive({
																endpoint: candidate.endpoint,
																scope: targetOptions.scope,
																status,
															})) {
																topicDownloadUnavailableQuoteTargets.add(quoteKey);
																break;
															}
															if ([401, 403].includes(status)) break;
													}
												}
											}
								if (quotedPost) {
									topicDownloadUnavailableQuoteTargets.delete(quoteKey);
								quotedPosts.set(
									quoteKey,
													Object.freeze({ topicId: target.topicId, post: quotedPost }),
												);
											} else {
												missingQuoteTargetCount += 1;
											}
										}
										if (missingQuoteTargetCount > 0) {
											specialContentWarnings.push(
												`${missingQuoteTargetCount} 个引用正文未能补齐`,
											);
										}
										const offlineTranslationController =
											runtime.translationFeature?.controller ?? null;
										const offlineTranslationMode =
											offlineTranslationController?.mode ?? 'original';
										const offlineTranslationTheme =
											offlineTranslationController?.theme;
										let offlineTranslations: ReadonlyMap<string, string> | null = null;
										if (
											offlineTranslationController &&
											offlineTranslationMode !== 'original'
										) {
											offlineTranslations = await offlineTranslationController
												.prepareOfflineTranslations(
												options.runtime.document,
												Object.freeze([
													...contextPosts,
													...[...quotedPosts.values()].map((entry) =>
														entry.post),
												]),
												abort.signal,
												{
													onProgress: (completed, total) => report({
														phase: 'serializing',
														completed,
														total,
														detail: `正在补齐离线译文 ${completed}/${total}`,
													}),
												},
											);
										}
										let selectedExpectedPostCount =
											session.postStreamCoverage().expectedPostCount;
										const selectedComplete = coverage.complete &&
											specialContentWarnings.length === 0;
										const filenameScope = selected.filenameScope;
										if (selection.mode !== 'all') {
											selectedExpectedPostCount = selected.expectedPostCount;
										}
										report({
											phase: 'serializing',
											completed: selection.mode === 'all'
												? contextPosts.length
												: selected.expectedPostCount,
											total: selectedExpectedPostCount,
											detail: [
												selection.mode === 'all'
													? '正在生成单文件离线 HTML'
													: `正在生成离线 HTML · 已准备 ${contextPosts.length} 楼讨论上下文`,
																coverage.warning,
																...specialContentWarnings,
															].filter(Boolean).join(' · '),
														});
										const title = String(
											topicRecord.fancy_title ?? topicRecord.title ?? fallbackTitle,
										).replace(/<[^>]+>/g, '').trim() || fallbackTitle;
										const rootNode = runtime.shell.view.root.getRootNode() as ParentNode;
										const readerRoot = runtime.shell.view.root;
										const readerStyleProperties: Record<string, string> = {};
										for (let index = 0; index < readerRoot.style.length; index += 1) {
											const name = readerRoot.style.item(index);
											if (!name.startsWith('--')) continue;
											readerStyleProperties[name] =
												readerRoot.style.getPropertyValue(name);
										}
										const stylesheet = rootNode.querySelector<HTMLStyleElement>(
											'style[data-ldp-reader-shadow]',
										)?.textContent ?? options.runtime.document
											.getElementById('ldp-mian-lite-styles')?.textContent ?? '';
										const replyTreePreferences = interactionFormOptions
											? interactionFormOptions.replyTree.read(
												context.readPreferences(),
											)
											: DEFAULT_READER_REPLY_TREE_PREFERENCES;
										const header = normalizeReaderTopicHeader(
											topic,
											contextPosts,
											queueTopicPresentation!,
											topicId,
										);
										const logo = runtime.shell.view.root
											.querySelector<HTMLImageElement>('.ldp-logo');
										const offlineKatex = options.runtime.media?.katex
											? new ReaderKatexController({
													document: options.runtime.document,
													katex: options.runtime.media.katex,
												})
											: null;
										const prepareCooked = (cooked: string): string => {
											const host = options.runtime.document.createElement('div');
											host.className = 'ldp-content cooked';
											host.innerHTML = cooked;
											prepareReaderCookedCallouts(options.runtime.document, host);
											offlineKatex?.render(host);
											if (offlineTranslations && offlineTranslationController) {
												offlineTranslationController.projectOfflineTranslations(
													host,
													offlineTranslations,
												);
											}
											return host.innerHTML;
										};
										let artifact: ReaderTopicOfflineDocument;
										try {
											artifact = createReaderTopicOfflineDocument({
											topicId,
											title,
											sourceUrl: new URL(
												`/t/${topicId}`,
												options.runtime.document.baseURI,
											).href,
											topic,
											posts: contextPosts,
											quotedPosts: Object.freeze([...quotedPosts.values()]),
											...(selection.mode !== 'all' && selected.mainPostNumbers
												? {
														mainPostNumbers: selected.mainPostNumbers,
														projectionMode: selection.mode,
													}
												: {}),
											expectedPostCount: selectedExpectedPostCount,
											complete: selectedComplete,
											archive,
											inlineReplyTreeMaxDepth:
												replyTreePreferences.inlineReplyTreeMaxDepth,
											header,
											siteLogoUrl: logo?.currentSrc || logo?.src || '',
											reactionEmojiUrl: (reactionId) =>
												discourseNativeEmojiUrl(options.runtime.host, reactionId),
											inlineEmojiUrl: (emojiId) =>
												discourseNativeEmojiUrl(options.runtime.host, emojiId),
											presentation: Object.freeze({
												theme: readerRoot.dataset.ldpTheme === 'dark'
													? 'dark'
													: 'light',
												translationMode: offlineTranslationMode,
												...(offlineTranslationTheme
													? {
														translationTheme: offlineTranslationTheme,
													}
													: {}),
												styleProperties: Object.freeze(readerStyleProperties),
												structureColorsDisabled: readerRoot.classList.contains(
													'ldp-structure-colors-disabled',
												),
											}),
											stylesheet,
											prepareCooked,
											});
										} finally {
											offlineKatex?.destroy();
										}
										const downloadArtifact = Object.freeze({
											...artifact,
											archiveStatus: archive.topic?.status ??
												archive.posts[0]?.status ?? null,
										});
										return filenameScope
											? Object.freeze({
												...downloadArtifact,
												filename: downloadArtifact.filename.replace(
													/-lite-offline\.html$/,
													`-${filenameScope}-lite-offline.html`,
												),
											})
											: downloadArtifact;
									} finally {
										await bundle.prepareClose?.('close');
										scope.destroy();
									}
								},
							},
						}
						: {}),
					closeReader: () => runtime.close(),
					composerOpen: () => runtime.composer.isOpen(),
					readerLightboxOpen: () => Boolean(
						readerSurfaceQuery(
							options.runtime.document,
							'.ldp-lightbox',
						),
					),
					readerSurfaceOpen: () => runtime.readerSurfaceOpen(),
					closeExpandedReply: () => runtime.closeExpandedReply(),
					readPreferences: () => queuePreferences.read(
						context.readPreferences(),
					),
					updatePreferences: (patch) => {
						const current = queuePreferences.read(
							context.readPreferences(),
						);
						void context.updatePreferences!(
							queuePreferences.createPatch(Object.freeze({
								...current,
								...patch,
							})),
						);
					},
					notify: (message) => runtime.feedback.show(message),
					parentScope: runtime.scope,
				})
					: null;
				if (openQueue) {
					downloadCurrentTopic = () => {
						openQueue.downloadCurrentTopic();
					};
					runtime.scope.add(() => {
						downloadCurrentTopic = null;
					});
					const syncOpenQueue = (): void => openQueue.sync();
					runtime.shell.changes.subscribe(syncOpenQueue, runtime.scope);
					runtime.history.changes.subscribe(syncOpenQueue, runtime.scope);
					context.preferenceChanges.subscribe(syncOpenQueue, runtime.scope);
					workspace.workspace.changes.subscribe(
						() => openQueue.refreshSurface(),
						runtime.scope,
					);
				}
			const informationFlow = options.informationFlow ??
				new ReaderInformationFlowCoordinator({
					storageEvents: options.runtime.storageEvents ?? null,
					parentScope: runtime.scope,
					onDiagnostic: ({ domain, source, cause }) => {
						console.error(
							`[main-lite:information-flow:${domain}:${source}]`,
							cause,
						);
					},
				});
			runtime.scope.add(informationFlow.connectCache(
				runtime.data.cacheCoordination,
			));
			const registerInformationFlow = (
				registration: Parameters<typeof informationFlow.register>[0],
			): void => {
				runtime.scope.add(informationFlow.register(registration));
			};
			registerInformationFlow({
				domain: 'reading-history',
				storageKeys: [runtime.history.storageKey],
				refresh: () => runtime.history.reloadExternal(),
			});
			registerInformationFlow({
				domain: 'chronicle',
				storageKeys: [runtime.chronicle.storageKey],
				refresh: () => runtime.chronicle.reloadExternal(),
			});
			registerInformationFlow({
				domain: 'unwanted-topics',
				storageKeys: [runtime.unwantedTopics.storageKey],
				refresh: () => runtime.unwantedTopics.reloadExternal(),
			});
			registerInformationFlow({
				domain: 'user-observations',
				storageKeys: [runtime.userObservations.storageKey],
				refresh: () => runtime.userObservations.reloadExternal(),
			});
			registerInformationFlow({
				domain: 'topic-context',
				storageKeys: [runtime.threadContextState.storageKey],
				subscriptions: [{
					source: 'userscript-value',
					subscribe: (notify) => runtime.threadContextState
						.subscribeExternal(notify),
				}],
				refresh: () => runtime.threadContextState.reloadExternal(),
			});
			registerInformationFlow({
				domain: 'topic-summary-state',
				storageKeys: [
					READER_TOPIC_SUMMARY_RESULTS_STORAGE_KEY,
					READER_TOPIC_SUMMARY_SHARE_SETTINGS_KEY,
				],
				storageKeyPrefixes: [
					`${READER_TOPIC_SUMMARY_WINDOW_GEOMETRY_STORAGE_KEY_PREFIX}:`,
				],
				refresh: () => runtime.reloadExternalTopicSummaryState(),
			});
			registerInformationFlow({
				domain: 'surface-layout',
				storageKeys: [READER_COLLECTION_FLOATING_WINDOW_GEOMETRY_KEY],
				refresh: () => reloadReaderFloatingWindowTabGeometry(
					runtime.shell.view.surfaceHost,
				),
			});
			if (runtime.connectHistory) {
				registerInformationFlow({
					domain: 'connect-trust-history',
					storageKeys: [runtime.connectHistory.storageKey],
					refresh: () => runtime.connectHistory?.reloadExternal(),
				});
			}
			if (runtime.creditAccount) {
				registerInformationFlow({
					domain: 'credit-account',
					subscriptions: [{
						source: 'userscript-value',
						subscribe: (notify) => runtime.creditAccount!
							.subscribeExternal(notify),
					}],
					refresh: () => runtime.users.reloadExternalCredit(),
				});
			}
			const projectionScope = encodeURIComponent(
				String(options.runtime.topic.authScope).trim(),
			);
			if (runtime.notificationController) {
				registerInformationFlow({
					domain: 'notifications',
					cacheIdPrefixes: [
						'reader-collection-projection:notifications:manifest:v1:' +
						`${projectionScope}:`,
					],
					refresh: () => runtime.notificationController
						?.reloadExternalProjection(),
				});
			}
			if (runtime.bookmarkController) {
				registerInformationFlow({
					domain: 'bookmarks',
					cacheIdPrefixes: [
						'reader-collection-projection:bookmarks:manifest:v1:' +
						`${projectionScope}:`,
					],
					refresh: () => runtime.bookmarkController
						?.reloadExternalProjection(),
				});
			}
			if (openQueue) {
				registerInformationFlow({
					domain: 'reader-queue',
					storageKeys: [openQueue.storageKey],
					refresh: () => openQueue.reloadExternal(),
				});
				if (topicOfflineArtifacts) {
					registerInformationFlow({
						domain: 'download-history',
						cacheIds: [topicOfflineArtifacts.manifestCacheId],
						refresh: () => openQueue.reloadExternalDownloads(),
					});
				}
			}
			const translationOptions = options.settings
				? options.settings.translationForm
				: undefined;
			if (webDavOptions && !settingsView) {
				runtime.destroy();
				throw new Error('WebDAV 设置需要启用唯一 Settings View');
			}
			if (settingsView && webDavOptions) {
				const coordinator = new ReaderWebDavCoordinator({
					client: webDavOptions.client,
					repository: webDavOptions.repository,
						categories: createReaderWebDavCategoryPorts({
							history: runtime.history,
							notifications: runtime.notificationController,
						bookmarks: runtime.bookmarkController,
						queue: openQueue,
						preferences: {
							read: context.readPreferences,
							validate: (id, value, records) => {
								const preferences = context.readPreferences();
								return readerWebDavPreferenceRecordMatchesSchema(
									preferences,
									id,
									value,
									(candidate) => webDavOptions.preferencesCodec
										.export(candidate).settings,
									records,
								);
							},
							update: (patch) => {
								context.updatePreferences!(patch);
							},
						},
						topicContext: runtime.threadContextState,
						customSites: webDavOptions.customSites,
						connectHistory: runtime.connectHistory,
						translation: translationOptions
							? translationOptions.repository
							: null,
						translationCache: options.runtime.translation
							? {
								responses: runtime.data.responses,
								cache: options.runtime.translation.translationCache,
							}
							: null,
						offlineTopics: topicOfflineArtifacts,
					}),
					hostname: () => options.runtime.document.location.hostname,
					username: () => discourseNativeCurrentUsername(
						options.runtime.host,
					),
				});
				webDavCoordinator = coordinator;
				runtime.scope.add(() => {
					if (webDavCoordinator === coordinator) webDavCoordinator = null;
				});
				const webDavSettingsForm = new ReaderWebDavSettingsForm({
					document: options.runtime.document,
					host: settingsView.panelHost('sync'),
					repository: webDavOptions.repository,
					coordinator,
					unavailableReason: () =>
						discourseNativeCurrentUsername(options.runtime.host)
							? ''
							: (
								'当前未登录 Discourse，WebDAV 同步不可用。' +
								'请先登录并刷新页面。'
							),
					parentScope: runtime.scope,
				});
				settingsView.changes.subscribe((snapshot) => {
					if (snapshot.open && snapshot.activePanelId === 'sync') {
						webDavSettingsForm.refreshAvailability();
					}
				}, runtime.scope);
				new ReaderWebDavAutoSync({
					repository: webDavOptions.repository,
					coordinator,
					visibilityState: () =>
						options.runtime.document.visibilityState,
					parentScope: runtime.scope,
				});
			}
			const notificationTrigger = shell.view.root
				.querySelector<HTMLElement>('.ldp-notifications-toggle');
			const historyTrigger = shell.view.root
				.querySelector<HTMLElement>('.ldp-history-toggle');
			const bookmarkTrigger = shell.view.root
				.querySelector<HTMLElement>('.ldp-bookmarks-toggle');
			const settingsTrigger = shell.view.root
				.querySelector<HTMLElement>('.ldp-settings-toggle');
			const exclusivePanels = [
				...(runtime.notificationController && notificationTrigger
					? [{
						id: 'notifications',
						coexistGroup: 'floating-tools',
						trigger: notificationTrigger,
						isOpen: () => runtime.notificationController!.snapshot.open,
						open: () => runtime.notificationController!.open(),
						close: () => runtime.notificationController!.close(),
					}]
					: []),
				...(runtime.historyPanelView && historyTrigger
					? [{
						id: 'history',
						coexistGroup: 'floating-tools',
						trigger: historyTrigger,
						isOpen: () => runtime.historyPanelView!.snapshot.open,
						open: () => runtime.historyPanelView!.open(),
						close: () => runtime.historyPanelView!.close(),
					}]
					: []),
				...(runtime.bookmarkController && bookmarkTrigger
					? [{
						id: 'bookmarks',
						coexistGroup: 'floating-tools',
						trigger: bookmarkTrigger,
						isOpen: () => runtime.bookmarkController!.snapshot.open,
						open: () => runtime.bookmarkController!.open(),
						close: () => runtime.bookmarkController!.close(),
					}]
					: []),
				...(settingsView && settingsTrigger
					? [{
						id: 'settings',
						trigger: settingsTrigger,
						isOpen: () => settingsView.snapshot.open,
						open: () => settingsView.open(),
						close: () => settingsView.requestClose(),
					}]
					: []),
			];
			if (exclusivePanels.length > 1) {
				new ReaderExclusivePanelCoordinator({
					entries: exclusivePanels,
					beforeOpen: (target) => {
						if (
							target.id === 'settings' &&
							runtime.unwantedTopicView.window.isOpen
						) {
							runtime.unwantedTopicView.close();
						}
					},
					parentScope: runtime.scope,
					onError: (cause) => {
						runtime.feedback.show(
							cause instanceof Error
								? cause.message
								: '面板切换失败',
						);
					},
				});
			}
			const shortcutPreferences = options.shortcuts || null;
			if (shortcutPreferences && !context.updatePreferences) {
				runtime.destroy();
				throw new Error(
					'快捷键设置需要 application 唯一偏好写端口',
				);
			}
			let fullscreenReturnMode =
				workspace.workspace.snapshot.presentation.mode === 'fullpage'
					? 'floating'
					: workspace.workspace.snapshot.presentation.mode;
			const triggerTopicAction = (selector: string): boolean => {
				const button = runtime.shell.activeValue?.topicActionRail?.view
					?.slots.actions.querySelector<HTMLButtonElement>(selector);
				if (!button || button.disabled || button.hidden) return false;
				button.click();
				return true;
			};
			const triggerHeaderPanel = (selector: string): boolean => {
				const trigger = shell.view.root.querySelector<HTMLElement>(selector);
				if (
					!trigger ||
					trigger.hidden ||
					trigger.getAttribute('aria-disabled') === 'true' ||
					('disabled' in trigger &&
						(trigger as HTMLButtonElement).disabled)
				) return false;
				trigger.click();
				return true;
			};
			const triggerFloatingPanelShortcut = (
				selector: string,
				tabId: string,
			): boolean =>
				restoreReaderFloatingWindowTabSession(
					shell.view.surfaceHost,
					tabId,
				) ||
				triggerHeaderPanel(selector);
			const shortcuts = shortcutPreferences
				? new ReaderShortcutController<TPreferences>({
					target: options.runtime.document,
					preferences: shortcutPreferences,
					readPreferences: context.readPreferences,
					preferenceChanges: context.preferenceChanges,
					persist: context.updatePreferences!,
					canExecute: (action, event) => {
						if (readerSurfaceOnlyCloseEvents.has(event)) return false;
						if (
							action === 'refreshHost' &&
							!workspace.workspace.snapshot.presentation.embedded
						) return false;
						if (runtime.readerShortcutContextBlocked()) return false;
						if (action !== 'closeReader') return true;
						const binding = readerShortcutBindingFromEvent(event);
						if (binding === 'Escape') return !runtime.readerExitBlocked();
						return true;
					},
					onUnavailable: (_action, label) => {
						runtime.feedback.show(`“${label}”当前不可用`);
					},
					execute: (action, event) => {
						const active = runtime.shell.activeValue;
						switch (action) {
							case 'historyBack':
								return runtime.historyNavigation.navigate('back');
							case 'historyForward':
								return runtime.historyNavigation.navigate('forward');
							case 'topicTop':
								return active
									? active.topicTimeline.jumpTo(1, {
										alignment: 'start',
										highlight: true,
									})
									: false;
							case 'topicBottom':
								return active
									? active.topicTimeline.jumpTo(
										active.topicTimeline.snapshot.totalPostCount,
										{
											alignment: 'start',
											highlight: true,
										},
									)
									: false;
							case 'floorJump':
								if (!active?.topicTimelineView) return false;
								active.topicTimelineView.focusJump();
								return true;
							case 'discussionHorizontalScroll':
								return active?.topicContextSurface
									.scrollDiscussionHorizontal(
										event.type === 'wheel'
											? (event as WheelEvent).deltaY ||
												(event as WheelEvent).deltaX
											: 0,
									) ?? false;
							case 'onlyAuthor':
								if (!active) return false;
								active.topicOnlyOp.toggle();
								return true;
							case 'translate':
								if (!runtime.translationFeature) return false;
								runtime.translationFeature.controller.cycleMode();
								return true;
							case 'refreshTopic':
								if (!active || refreshTopicButton.disabled) {
									return false;
								}
								refreshTopicButton.click();
								return true;
							case 'refreshHost':
								return discourseNativeHostRouteRefresh(
									options.runtime.host,
								);
							case 'openOriginal': {
								const link = shell.view.root
									.querySelector<HTMLAnchorElement>('a.ldp-open');
								if (!link?.href || link.hidden) return false;
								link.click();
								return true;
							}
							case 'settings':
								return triggerHeaderPanel('.ldp-settings-toggle');
							case 'notifications':
								return triggerFloatingPanelShortcut(
									'.ldp-notifications-toggle',
									'notifications',
								);
							case 'historyPanel':
								return triggerFloatingPanelShortcut(
									'.ldp-history-toggle',
									'history',
								);
							case 'bookmarksPanel':
								return triggerFloatingPanelShortcut(
									'.ldp-bookmarks-toggle',
									'bookmarks',
								);
							case 'likeTopic':
								return triggerTopicAction('button[data-post-like]');
							case 'replyTopic':
								return triggerTopicAction('button[data-post-reply]');
							case 'bookmarkTopic':
								return triggerTopicAction('button[data-post-bookmark]');
							case 'toggleFullscreen': {
								const mode =
									workspace.workspace.snapshot.presentation.mode;
								if (mode === 'fullpage') {
									return workspace.setMode(fullscreenReturnMode);
								}
								fullscreenReturnMode = mode;
								return workspace.setMode('fullpage');
							}
							case 'toggleQueue':
								if (!openQueue) return false;
								openQueue.toggle();
								return true;
							case 'closeReader':
								return runtime.handleCloseReaderShortcut(event);
						}
					},
					onError: (cause) => {
						runtime.feedback.show(
							cause instanceof Error
								? cause.message
								: '快捷操作执行失败',
						);
					},
					parentScope: runtime.scope,
				})
				: null;
			if (settingsView && shortcuts) {
				new ReaderShortcutSettingsForm<TPreferences>({
					document: options.runtime.document,
					host: settingsView.panelHost('shortcuts'),
					shortcuts,
					parentScope: runtime.scope,
				});
			}
			if (
				performancePolicy ||
				navigationPreferences ||
				loadingAnimation
			) {
				context.preferenceChanges.subscribe((preferences) => {
					let performanceSnapshot: ReaderPerformanceSnapshot | null =
						null;
					if (
						performancePolicy &&
						options.selectPerformancePreferences
					) {
						performanceSnapshot = performancePolicy.apply(
							options.selectPerformancePreferences(preferences),
						);
					}
					if (
						navigationPreferences &&
						selectNavigationPreferences
					) {
						navigationPreferences.apply(
							selectNavigationPreferences(preferences),
						);
						navigationPreferences.refreshPerformance();
					}
					if (loadingAnimation && motionPreferences) {
						loadingAnimation.apply(
							motionPreferences.read(preferences).loadingAnimation,
						);
					}
					if (performanceSnapshot) {
						runtime.applyPerformance(performanceSnapshot);
					}
				}, runtime.scope);
			}
			if (
				runtime.historyNavigationView &&
				options.selectHistoryNavigationPreferences
			) {
				context.preferenceChanges.subscribe((preferences) => {
					runtime.historyNavigationView?.applyPreferences(
						options.selectHistoryNavigationPreferences!(
							preferences,
						),
					);
				}, runtime.scope);
			}
			if (
				runtime.historyPanelView &&
				options.selectHistoryPanelPreferences
			) {
				context.preferenceChanges.subscribe((preferences) => {
					const projection =
						options.selectHistoryPanelPreferences!(preferences);
					runtime.historyPanelView?.applyPreferences(projection);
					runtime.historyNavigation.refreshOrder();
				}, runtime.scope);
			}
			if (
				runtime.bookmarkController &&
				options.selectBookmarkPreferences
			) {
				context.preferenceChanges.subscribe((preferences) => {
					runtime.bookmarkController?.applyTabOrder(
						options.selectBookmarkPreferences!(preferences).tabOrder,
					);
				}, runtime.scope);
			}
			if (options.selectTimelineViewPreferences) {
				context.preferenceChanges.subscribe((preferences) => {
					timelinePreferences =
						options.selectTimelineViewPreferences!(preferences);
					runtime.shell.activeValue?.topicTimelineView
						?.applyPreferences(timelinePreferences);
				}, runtime.scope);
			}
			if (
				runtime.translationFeature &&
				options.selectTranslationMode
			) {
				context.preferenceChanges.subscribe((preferences) => {
					runtime.translationFeature?.applyMode(
						options.selectTranslationMode!(preferences),
					);
					runtime.translationFeature?.syncMountedPosts();
				}, runtime.scope);
			}
			let readyCleanup: Cleanup | undefined;
			try {
				readyCleanup =
					options.onReady?.(
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
				runtime.destroy();
				throw error;
			}
			return () => {
				try {
					readyCleanup?.();
				} finally {
					runtime.destroy();
				}
			};
		},
	});
}
