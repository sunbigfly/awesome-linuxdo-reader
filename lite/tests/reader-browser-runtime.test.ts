import { parseHTML } from 'linkedom';
import {
	ReaderApplication,
} from '../src/app/reader-application.js';
import {
	createReaderBrowserRuntimeStage,
	type ReaderBrowserRuntime,
} from '../src/app/reader-browser-runtime.js';
import {
	discoursePostId,
	discoursePostNumber,
	discourseTopicId,
} from '../src/discourse/identifiers.js';
import { Signal } from '../src/kernel/signal.js';
import {
	READER_HISTORY_STORAGE_KEY,
} from '../src/history/reader-history-repository.js';
import { createReaderShellTemplate } from '../src/shell/reader-shell-template.js';
import type {
	ReaderSettingsController,
} from '../src/settings/reader-settings-controller.js';
import type {
	ReaderSettingsView,
} from '../src/settings/reader-settings-view.js';
import type {
	ReaderAppearanceStyleController,
} from '../src/appearance/reader-appearance-style-controller.js';
import {
	READER_FONT_SETTINGS_DEFAULT,
	type ReaderFontSettings,
	type ReaderFontStyleController,
} from '../src/font/reader-font-style-controller.js';
import {
	READER_APPEARANCE_DEFAULT,
} from '../src/state/reader-preferences-schema.js';
import {
	readerAccountScopedStorageIdentity,
} from '../src/state/reader-account-scoped-storage.js';
import type {
	ReaderAppearanceProfile,
	ReaderLayoutProfile,
} from '../src/state/reader-preferences-schema.js';
import type {
	ReaderLayoutStyleController,
} from '../src/layout/reader-layout-style-controller.js';
import type {
	CanonicalActionPost,
} from '../src/post/post-action-feature-commands.js';
import type {
	DiscourseTopicPayload,
	DiscourseTopicPostInput,
} from '../src/topic/topic-session.js';
import type {
	ReaderTopicNavigationResult,
} from '../src/topic/reader-topic-navigation-controller.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function deferred<T>(): Readonly<{
	readonly promise: Promise<T>;
	readonly resolve: (value: T) => void;
}> {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((accept) => {
		resolve = accept;
	});
	return Object.freeze({ promise, resolve });
}

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
	readonly values = new Map<string, string>();

	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
}

interface TestPost extends DiscourseTopicPostInput, CanonicalActionPost {
	readonly id: number;
	readonly topic_id: number;
	readonly post_number: number;
	readonly reply_to_post_number: number | null;
	readonly username: string;
	readonly cooked: string;
	readonly read?: boolean;
	readonly accepted_answer?: boolean;
	readonly avatar_template?: string;
	readonly name?: string;
	readonly reactions?: readonly Readonly<{
		readonly id: string;
		readonly count: number;
	}>[];
	readonly current_user_reaction?: Readonly<{ readonly id: string }> | null;
	readonly reaction_users_count?: number;
}

interface TestTopic extends DiscourseTopicPayload<TestPost> {
	readonly id: number;
	readonly title: string;
	readonly posts_count: number;
	readonly views?: number;
	readonly like_count?: number;
	readonly participant_count?: number;
	readonly details?: {
		readonly created_by: { readonly username: string };
	};
	readonly category_id?: number;
	readonly category_name?: string;
	readonly tags?: readonly string[];
	readonly accepted_answers?: readonly Readonly<{
		readonly post_number: number;
	}>[];
	readonly post_stream: {
		readonly stream: readonly number[];
		readonly posts: readonly TestPost[];
	};
}

interface TestPreferences {
	readonly performancePageSize: number;
	readonly performanceStreamOverscan: number;
	readonly performanceStreamMaxItems: number;
	readonly performanceNestedPrefetch: number;
	readonly performanceRequestConcurrency: number;
	readonly performanceRequestInterval: number;
	readonly performanceRequestRateTarget: number;
	readonly layoutProfile: ReaderLayoutProfile;
	readonly fullpageLayoutProfile: ReaderLayoutProfile;
	readonly appearanceProfile: ReaderAppearanceProfile;
	readonly fontSettings: ReaderFontSettings;
	readonly jumpHighlightColor: string;
	readonly jumpHighlightRadius: number;
	readonly jumpHighlightBorderWidth: number;
	readonly jumpHighlightRate: number;
	readonly jumpHighlightCount: number;
	readonly historyEdgeTriggerPercent: number;
	readonly historyButtonsAlwaysVisible: boolean;
	readonly historySortMode: 'first-viewed' | 'recent-viewed';
	readonly openTopicsAtFirstPost: boolean;
	readonly readerQueueAlwaysVisibleWhenEmpty: boolean;
	readonly doubleEscapeToCloseReader: boolean;
	readonly confirmNativeComposerClose: boolean;
	readonly translationMode: 'original' | 'bilingual' | 'translation';
	readonly topicActionRailVisible: boolean;
	readonly topicActionRailFixed: boolean;
	readonly topicActionRailMode: 'collapsed' | 'compact';
	readonly topicActionRailPositions: Readonly<{
		readonly floating: Readonly<{
			readonly x: 'left' | 'right' | number;
			readonly y: number;
		}>;
		readonly fullpage: Readonly<{
			readonly x: 'left' | 'right' | number;
			readonly y: number;
		}>;
		readonly embedded: Readonly<{
			readonly x: 'left' | 'right' | number;
			readonly y: number;
		}>;
	}>;
}

const initialPreferences: Readonly<TestPreferences> = Object.freeze({
	performancePageSize: 16,
	performanceStreamOverscan: 1,
	performanceStreamMaxItems: 72,
	performanceNestedPrefetch: 1,
	performanceRequestConcurrency: 3,
	performanceRequestInterval: 90,
	performanceRequestRateTarget: 80,
	layoutProfile: Object.freeze({
		left: 0,
		main: 88,
		gap: 0,
		timeline: 8,
		right: 4,
	}),
	fullpageLayoutProfile: Object.freeze({
		left: 15,
		main: 70,
		gap: 5,
		timeline: 8,
		right: 2,
	}),
	appearanceProfile: READER_APPEARANCE_DEFAULT,
	fontSettings: READER_FONT_SETTINGS_DEFAULT,
	jumpHighlightColor: '#123456',
	jumpHighlightRadius: 9,
	jumpHighlightBorderWidth: 1,
	jumpHighlightRate: 1,
	jumpHighlightCount: 2,
	historyEdgeTriggerPercent: 15,
	historyButtonsAlwaysVisible: false,
	historySortMode: 'recent-viewed',
	openTopicsAtFirstPost: false,
	readerQueueAlwaysVisibleWhenEmpty: true,
	doubleEscapeToCloseReader: false,
	confirmNativeComposerClose: true,
	translationMode: 'original',
	topicActionRailVisible: true,
	topicActionRailFixed: false,
	topicActionRailMode: 'compact',
	topicActionRailPositions: Object.freeze({
		floating: Object.freeze({ x: 'left', y: 0.95 }),
		fullpage: Object.freeze({ x: 'left', y: 0.95 }),
		embedded: Object.freeze({ x: 'left', y: 0.95 }),
	}),
});
let activePreferences = initialPreferences;
const preferenceChanges = new Signal<{
	readonly value: Readonly<TestPreferences>;
}>();
let latestHighlightLifetime = 0;
const runtimeStorage = new MemoryStorage();

const posts: readonly TestPost[] = Object.freeze([
	Object.freeze({
		id: 101,
		topic_id: 10,
		post_number: 1,
		reply_to_post_number: null,
		username: 'root',
		created_at: '2026-07-30T00:00:00.000Z',
		can_reply: true,
		can_boost: true,
		actions_summary: Object.freeze([]),
		cooked:
			'<p>root-content</p>' +
			'<p>A complete runtime translation sentence.</p>' +
			'<blockquote><p>[!TIP]- Runtime tip<br>tip body</p></blockquote>' +
			`<pre>${Array.from({ length: 11 }, (_, index) =>
				`line-${index + 1}`).join('\n')}</pre>` +
			'<p><img src="/uploads/default/original/1X/runtime.png" alt="runtime image"></p>' +
			'<iframe src="https://player.bilibili.com/player.html?autoplay=1"></iframe>',
		read: true,
	}),
	Object.freeze({
		id: 102,
		topic_id: 10,
		post_number: 2,
		reply_to_post_number: 1,
		username: 'child',
		name: 'Child',
		avatar_template: '/avatar/{size}.png',
		created_at: '2026-07-30T01:00:00.000Z',
		cooked: 'child-content',
		accepted_answer: true,
	}),
]);
const topic: TestTopic = Object.freeze({
	id: 10,
	title: 'Initial topic title',
	posts_count: 2,
	views: 40,
	like_count: 5,
	participant_count: 2,
	details: Object.freeze({
		created_by: Object.freeze({ username: 'root' }),
	}),
	category_id: 7,
	category_name: '测试分类, Lv1',
	tags: Object.freeze(['纯水']),
	accepted_answers: Object.freeze([
		Object.freeze({ post_number: 2 }),
	]),
	shared_issue_visible: true,
	shared_issue_count: 1,
	user_created_shared_issue: false,
	created_at: '2026-07-30T00:00:00.000Z',
	last_posted_at: '2026-07-30T01:00:00.000Z',
	post_stream: Object.freeze({
		stream: Object.freeze([101, 102]),
		posts,
	}),
});
const refreshedTopic: TestTopic = Object.freeze({
	...topic,
	title: 'Refreshed topic title',
});
const rebuiltTopic: TestTopic = Object.freeze({
	...topic,
	title: 'Rebuilt topic title',
});
const topic11: TestTopic = Object.freeze({
	id: 11,
	title: 'Next topic title',
	posts_count: 1,
	post_stream: Object.freeze({
		stream: Object.freeze([111]),
		posts: Object.freeze([
			Object.freeze({
				id: 111,
				topic_id: 11,
				post_number: 1,
				reply_to_post_number: null,
				username: 'next-root',
				cooked: 'next-content',
				read: true,
			}),
		]),
	}),
});
const topic12: TestTopic = Object.freeze({
	...topic11,
	id: 12,
	title: 'Recovered topic title',
	post_stream: Object.freeze({
		stream: Object.freeze([121]),
		posts: Object.freeze([
			Object.freeze({
				id: 121,
				topic_id: 12,
				post_number: 1,
				reply_to_post_number: null,
				username: 'recovered-root',
				cooked: 'recovered-content',
				read: true,
			}),
		]),
	}),
});
const topic13Posts = Object.freeze<TestPost[]>([
	Object.freeze({
		id: 131,
		topic_id: 13,
		post_number: 1,
		reply_to_post_number: null,
		username: 'concurrent-root',
		cooked: 'concurrent-root-content',
		read: true,
	}),
	Object.freeze({
		id: 132,
		topic_id: 13,
		post_number: 2,
		reply_to_post_number: 1,
		username: 'concurrent-child',
		cooked: 'concurrent-child-content',
	}),
]);
const topic13: TestTopic = Object.freeze({
	id: 13,
	title: 'Concurrent target topic',
	posts_count: 2,
	post_stream: Object.freeze({
		stream: Object.freeze([131, 132]),
		posts: topic13Posts,
	}),
});
const topic14: TestTopic = Object.freeze({
	...topic11,
	id: 14,
	title: 'Request timeout recovered topic',
	post_stream: Object.freeze({
		stream: Object.freeze([141]),
		posts: Object.freeze([
			Object.freeze({
				id: 141,
				topic_id: 14,
				post_number: 1,
				reply_to_post_number: null,
				username: 'timeout-root',
				cooked: 'timeout-recovered-content',
				read: true,
			}),
		]),
	}),
});
const topic13Gate = deferred<TestTopic>();
const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><head><meta name="generator" content="Discourse"></head>' +
	'<body><div id="ember-app"><main id="main-outlet"></main></div></body></html>',
);
const document = parsedDocument as unknown as Document;
const mount = document.body;
const eventTarget = document.createElement('div');
const nativeCalls: Array<{
	readonly path: string;
	readonly options: Readonly<Record<string, unknown>>;
}> = [];
let externalTranslationCalls = 0;
const translationErrors: string[] = [];
const subscriptions = new Map<string, (message: unknown) => void>();
const appEventSubscriptions = new Map<
	string,
	Set<(payload?: unknown) => void>
>();
const appEvents = {
	on(
		eventName: string,
		ownerOrHandler: unknown,
		maybeHandler?: (payload?: unknown) => void,
	) {
		const handler = maybeHandler ??
			(ownerOrHandler as (payload?: unknown) => void);
		const handlers = appEventSubscriptions.get(eventName) ?? new Set();
		handlers.add(handler);
		appEventSubscriptions.set(eventName, handlers);
	},
	off(
		eventName: string,
		ownerOrHandler: unknown,
		maybeHandler?: (payload?: unknown) => void,
	) {
		const handler = maybeHandler ??
			(ownerOrHandler as (payload?: unknown) => void);
		const handlers = appEventSubscriptions.get(eventName);
		handlers?.delete(handler);
		if (!handlers?.size) appEventSubscriptions.delete(eventName);
	},
	trigger(eventName: string, payload?: unknown) {
		for (const handler of [...(appEventSubscriptions.get(eventName) ?? [])]) {
			handler(payload);
		}
	},
};
const messageBus = {
	subscribe(channel: string, handler: (message: unknown) => void) {
		subscriptions.set(channel, handler);
	},
	unsubscribe(channel: string, handler: (message: unknown) => void) {
		if (subscriptions.get(channel) === handler) subscriptions.delete(channel);
	},
};
let nativeAjaxLookups = 0;
const nativeAjaxObservationHandlers = new Map<
	string,
	(...args: readonly unknown[]) => void
>();
let nativeAjaxObservationBinds = 0;
let nativeAjaxObservationUnbinds = 0;
const nativeAjaxObservationTarget = {
	on(name: string, handler: (...args: readonly unknown[]) => void) {
		nativeAjaxObservationBinds += 1;
		nativeAjaxObservationHandlers.set(name, handler);
	},
	off(name: string, handler: (...args: readonly unknown[]) => void) {
		nativeAjaxObservationUnbinds += 1;
		if (nativeAjaxObservationHandlers.get(name) === handler) {
			nativeAjaxObservationHandlers.delete(name);
		}
	},
};
const nativeAjaxObservationState = (): string => [
	nativeAjaxObservationHandlers.size,
	nativeAjaxObservationBinds,
	nativeAjaxObservationUnbinds,
].join('/');
let topic10Response = topic;
let topic12Attempts = 0;
let topic14Attempts = 0;
let topic14RefreshFailure = false;
let topic15Attempts = 0;
let challengeVerificationRateLimited = false;
const openRetryDelays: number[] = [];
const nativeHost = {
	lookup(name: string): unknown {
		if (name === 'service:message-bus') return messageBus;
		if (name === 'service:app-events') return appEvents;
		if (name === 'service:current-user') return { username: 'viewer' };
		if (name === 'service:site-settings') {
			return { solved_allow_multiple_solutions: true };
		}
		if (name === 'service:site') {
			return { categories: [{ id: 7, slug: 'test' }] };
		}
		return null;
	},
	lookupModule(name: string): unknown {
		if (name === 'jquery') {
			return () => nativeAjaxObservationTarget;
		}
		if (name === 'discourse/lib/formatter') {
			return {
				relativeAge: () => '刚刚',
			};
		}
		if (name === 'discourse/lib/url') {
			return {
				getCategoryAndTagUrl(
					category: { id?: number } | null,
					_includeParent: boolean,
					tag?: string,
				) {
					return tag
						? `/tag/${tag}`
						: `/c/${category?.id ?? 0}`;
				},
				userPath: (username: string) => `/u/${username}`,
			};
		}
		if (name === 'discourse/lib/avatar-utils') {
			return {
				avatarUrl: (template: string, size: number) =>
					template.replace('{size}', String(size)),
			};
		}
		if (name !== 'discourse/lib/ajax') return null;
		nativeAjaxLookups += 1;
		return {
				ajax(path: string, options: Readonly<Record<string, unknown>>) {
					nativeCalls.push({ path, options });
					if (path === '/session/current.json' && challengeVerificationRateLimited) {
						return Promise.reject({ status: 429 });
					}
					if (path.startsWith('/t/13.json?')) {
					return topic13Gate.promise;
				}
				if (path.startsWith('/t/12.json?')) {
					topic12Attempts += 1;
					if (topic12Attempts < 3) {
						return Promise.reject(new TypeError('temporary network failure'));
					}
					return Promise.resolve(topic12);
				}
				if (path.startsWith('/t/14.json?')) {
					topic14Attempts += 1;
					if (topic14RefreshFailure) {
						return Promise.reject({ status: 503 });
					}
					if (topic14Attempts < 3) {
						return Promise.reject({ status: 408 });
					}
					return Promise.resolve(topic14);
				}
				if (path.startsWith('/t/15.json?')) {
					topic15Attempts += 1;
					return Promise.reject({ status: 503 });
				}
				return Promise.resolve(
					path.startsWith('/t/10.json?')
						? topic10Response
						: path.startsWith('/t/11.json?')
							? topic11
							: {},
				);
			},
		};
	},
};
const profile = {
	listZebraColor: '#f7f7f7',
	listZebraColorDark: '#242a31',
	structureColorsEnabled: true,
	dividerLineColor: '#e5e5e5',
	dividerLineColorDark: '#343b44',
	dividerLineWidth: 0.5,
} as ReaderAppearanceProfile;
let runtime: ReaderBrowserRuntime<TestTopic, TestPost> | null = null;
let settingsController: ReaderSettingsController<TestPreferences> | null = null;
let settingsView: ReaderSettingsView<TestPreferences> | null = null;
let layoutStyle: ReaderLayoutStyleController<TestPreferences> | null = null;
let appearanceStyle:
	ReaderAppearanceStyleController<TestPreferences> | null = null;
let fontStyle: ReaderFontStyleController<TestPreferences> | null = null;
let readyCleanups = 0;
let topicReadyImages = 0;
let topicFrameRequests = 0;
let topicRootSizeCallback:
	((entries: readonly Readonly<{
		readonly target: Element;
		readonly blockSize: number;
	}>[]) => void) | null = null;
let topicFactoryComposer: unknown = null;
let template: ReturnType<typeof createReaderShellTemplate> | null = null;
const stage = createReaderBrowserRuntimeStage<TestPreferences, TestTopic, TestPost>({
	shell: {
		compatibilityKey: () => 'reader:v1',
		createView: () => {
			template = createReaderShellTemplate({
				document,
				mount,
				listModeAllowed: true,
				siteName: 'LINUX DO',
				homeUrl: '/',
			});
			return template.view;
		},
		createWorkspaceOptions: () => {
			if (!template) throw new Error('Shell template 未创建');
			return {
				document,
				routeKind: 'list',
				requestedMode: 'floating',
				embedWidth: 600,
				windowPreferences: {
					readerWindowWidth: 0,
					readerWindowHeight: 0,
					readerWindowX: 0,
					readerWindowY: 0,
					readerWindowLocked: false,
					readerWindowPinned: false,
				},
				elements: template.workspaceElements,
				viewportTarget: eventTarget,
				pointerTarget: eventTarget,
				scrollTarget: eventTarget,
				readViewport: () => ({ width: 1_440, height: 900 }),
				hostScroll: {
					read: () => ({
						viewportHeight: 900,
						scrollHeight: 900,
						scrollTop: 0,
					}),
					scrollTo() {},
				},
				enhancements: {
					syncRoot() {},
					releaseRoot() {},
					syncActivity: () => true,
					syncCards() {},
					clear() {},
				},
				readAppearance: () => ({
					profile,
					theme: 'light',
					defaultDividerLineColor: '#e5e5e5',
					defaultDividerLineWidth: 0.5,
				}),
				createMutationObserver: () => ({ observe() {}, disconnect() {} }),
				createResizeObserver: () => ({ observe() {}, disconnect() {} }),
				requestFrame: () => 1,
				cancelFrame() {},
			};
		},
	},
	runtime: {
		host: nativeHost,
		share: {
			async share() {
				return 'unsupported';
			},
			async copyText() {},
		},
		document,
		storage: runtimeStorage,
		sourceId: 'reader-browser-runtime:test',
		locks: null,
		indexedDb: null,
		storageEvents: null,
		broadcastChannelFactory: null,
		permit: {
			shortWindowMs: 10_000,
			longWindowMs: 60_000,
			shortBudget: 40,
			longBudget: 160,
			minIntervalMs: 0,
			maxConcurrent: 3,
		},
		data: {
			scheduler: {
				maxConcurrent: 3,
				queueLimit: 20,
				defaultTimeoutMs: 5_000,
			},
			rateLimit: {
				evidenceWindowMs: 4_000,
				maxEndpointEntries: 128,
				retryAfterFallbackMs: 1_500,
				baseUrl: 'https://linux.do',
			},
			responseMemoryMaxEntries: 96,
			responseMemoryMaxBytes: 24 * 1024 * 1024,
			responsePersistentMaxEntries: 600,
			responsePersistentMaxBytes: 96 * 1024 * 1024,
			responseOperationTimeoutMs: 5_000,
			cacheFlightTtlMs: 30_000,
			cacheFlightStaleMs: 45_000,
		},
		openRetryDelay: async (milliseconds, signal) => {
			if (signal.aborted) throw signal.reason;
			openRetryDelays.push(milliseconds);
		},
		translation: {
			http: {
				async execute(descriptor) {
					externalTranslationCalls += 1;
					return {
						ok: true,
						status: 200,
						value: {
							body: descriptor.provider === 'google'
								? '[["运行时译文"]]'
								: '',
						},
					};
				},
			},
			fingerprint: async (texts) =>
				`sha256:runtime-translation:${texts.join('|')}`,
			translationCache: {
				kind: 'translations',
				tags: ['translation:zh-CN'],
				freshForMs: 1_000,
				retainForMs: 10_000,
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
		translationView: {
			startupDelayMs: 0,
			delay: async () => {},
			onError: (error) => translationErrors.push(
				error instanceof Error ? error.message : String(error),
			),
		},
		resources: {
			http: {
				async execute() {
					return {
						ok: true,
						status: 200,
						value: new Blob(['image']),
						retryAfter: null,
					};
				},
			},
			baseUrl: 'https://linux.do',
			cache: {
				kind: 'images',
				tags: ['images'],
				freshForMs: 1_000,
				retainForMs: 10_000,
				persist: true,
			},
			objectUrls: {
				createObjectURL: () => 'blob:runtime-image',
				revokeObjectURL() {},
			},
		},
		topic: {
			authScope: 'account:test',
			origin: 'https://linux.do',
			pageSize: 20,
			caches: {
				topic: { freshForMs: 1_000, retainForMs: 60_000, persist: true },
				posts: { freshForMs: 1_000, retainForMs: 60_000, persist: true },
				nested: { freshForMs: 1_000, retainForMs: 60_000, persist: true },
				snapshot: { freshForMs: 1_000, retainForMs: 60_000 },
			},
		},
		navigation: {
			createResizeObserver: () => null,
			schedule: (_callback, delayMs) => {
				latestHighlightLifetime = delayMs;
				return 1;
			},
			cancel() {},
		},
		topicFlowScheduler: {
			schedule: () => 1,
			cancel() {},
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
				topicHref: (entry) =>
					`https://linux.do/t/${entry.topicId}/${entry.postNumber}`,
				changeSortMode: (sortMode) => {
					activePreferences = Object.freeze({
						...activePreferences,
						historySortMode: sortMode,
					});
					preferenceChanges.emit({ value: activePreferences });
				},
			},
		},
		lightbox: {
			mount,
			commentsEnabled: false,
		},
		topicFactory: {
			createDomOptions: (bundle, _context, _root, services) => {
				topicFactoryComposer = services.composer;
				return {
					estimatedRootSize: 300,
					identity: (post) => ({
					postId: post.id,
					postNumber: post.post_number,
					username: post.username,
				}),
				render(post, view) {
					view.slots.content.innerHTML = post.cooked;
				},
				postFeatures: [{
					activationScope: 'node',
					attachRoot: (_postRoot, postNumber) => {
						bundle.services.read.setVisible([postNumber], 'root');
					},
					detachRoot: (_postRoot, postNumber) => {
						bundle.services.read.setVisible([postNumber], false);
					},
				}],
				observerFactory: (callback) => {
					topicRootSizeCallback = callback;
					return {
					observe() {},
					unobserve() {},
					disconnect() {},
					};
				},
					frameScheduler: {
						request: () => {
							topicFrameRequests += 1;
							return topicFrameRequests;
						},
						cancel() {},
					},
				};
			},
			onReady(value) {
				topicReadyImages += value.topicImages.snapshot().items.length;
			},
		},
	},
	selectPerformancePreferences: (preferences) => preferences,
	performanceBudgetCeilings: {
		short: 50,
		long: 200,
	},
	settings: {
		aboutContent: {
			version: '0.1.16',
		},
		performanceForm: {
			readConfig: (preferences) => ({
				pageSize: preferences.performancePageSize,
				streamOverscanViewports:
					preferences.performanceStreamOverscan,
				streamMaxItems: preferences.performanceStreamMaxItems,
				nestedPrefetchViewports:
					preferences.performanceNestedPrefetch,
				requestMaxConcurrent:
					preferences.performanceRequestConcurrency,
				requestMinInterval:
					preferences.performanceRequestInterval,
				requestRateTarget:
					preferences.performanceRequestRateTarget,
			}),
			createPatch: (config) => ({
				performancePageSize: config.pageSize,
				performanceStreamOverscan: config.streamOverscanViewports,
				performanceStreamMaxItems: config.streamMaxItems,
				performanceNestedPrefetch:
					config.nestedPrefetchViewports,
				performanceRequestConcurrency:
					config.requestMaxConcurrent,
				performanceRequestInterval: config.requestMinInterval,
				performanceRequestRateTarget: config.requestRateTarget,
			}),
		},
		readingForm: {
			read: (preferences) => ({
				historyButtonsAlwaysVisible:
					preferences.historyButtonsAlwaysVisible,
				historyEdgeTriggerPercent:
					preferences.historyEdgeTriggerPercent,
				historySortMode: preferences.historySortMode,
				openTopicsAtFirstPost:
					preferences.openTopicsAtFirstPost,
				readerQueueAlwaysVisibleWhenEmpty:
					preferences.readerQueueAlwaysVisibleWhenEmpty,
				doubleEscapeToCloseReader:
					preferences.doubleEscapeToCloseReader,
				confirmNativeComposerClose:
					preferences.confirmNativeComposerClose,
			}),
			createPatch: (reading) => ({
				historyButtonsAlwaysVisible:
					reading.historyButtonsAlwaysVisible,
				historyEdgeTriggerPercent:
					reading.historyEdgeTriggerPercent,
				historySortMode: reading.historySortMode,
				openTopicsAtFirstPost:
					reading.openTopicsAtFirstPost,
				readerQueueAlwaysVisibleWhenEmpty:
					reading.readerQueueAlwaysVisibleWhenEmpty,
				doubleEscapeToCloseReader:
					reading.doubleEscapeToCloseReader,
				confirmNativeComposerClose:
					reading.confirmNativeComposerClose,
			}),
		},
	},
	layout: {
		readProfile: (preferences, mode) =>
			mode === 'fullpage'
				? preferences.fullpageLayoutProfile
				: preferences.layoutProfile,
		createPatch: (profile, mode) =>
			mode === 'fullpage'
				? { fullpageLayoutProfile: profile }
			: { layoutProfile: profile },
	},
	appearance: {
		readProfile: (preferences) => preferences.appearanceProfile,
		createPatch: (appearanceProfile) => ({ appearanceProfile }),
	},
	font: {
		readSettings: (preferences) => preferences.fontSettings,
		createPatch: (fontSettings) => ({ fontSettings }),
	},
	topicActionRail: {
		read: (preferences) => ({
			visible: preferences.topicActionRailVisible,
			fixed: preferences.topicActionRailFixed,
			mode: preferences.topicActionRailMode,
			positions: preferences.topicActionRailPositions,
		}),
		createPatch: (rail) => ({
			topicActionRailVisible: rail.visible,
			topicActionRailFixed: rail.fixed,
			topicActionRailMode: rail.mode,
			topicActionRailPositions: rail.positions,
		}),
	},
	selectNavigationPreferences: (preferences) => preferences,
	selectTimelineViewPreferences: (preferences) => ({
		pageStep: preferences.performancePageSize,
	}),
	selectTranslationMode: (preferences) => preferences.translationMode,
	persistTranslationMode: (translationMode) => {
		activePreferences = Object.freeze({
			...activePreferences,
			translationMode,
		});
		preferenceChanges.emit({ value: activePreferences });
	},
	selectHistoryNavigationPreferences: (preferences) => ({
		edgeTriggerPercent: preferences.historyEdgeTriggerPercent,
		buttonsAlwaysVisible: preferences.historyButtonsAlwaysVisible,
	}),
	selectHistoryPanelPreferences: (preferences) => ({
		sortMode: preferences.historySortMode,
	}),
	onReady(value, _context, settings, view, layout, appearance, font) {
		runtime = value;
		settingsController = settings;
		settingsView = view;
		layoutStyle = layout;
		appearanceStyle = appearance;
		fontStyle = font;
		return () => {
			readyCleanups += 1;
		};
	},
});
const application = new ReaderApplication({
	bodyReady: async () => {},
	host: {
		async waitForHost() {
			return Object.freeze({ detection: 'native-module' as const });
		},
	},
	preferences: {
		changes: preferenceChanges,
		load: () => ({ value: initialPreferences }),
		update: (patch) => {
			activePreferences = Object.freeze({
				...activePreferences,
				...patch,
			});
			const snapshot = Object.freeze({ value: activePreferences });
			preferenceChanges.emit(snapshot);
			return snapshot;
		},
	},
	stages: [stage],
});
const applicationDiagnostics: string[] = [];
application.diagnostics.subscribe((diagnostic) => {
	applicationDiagnostics.push(
		`${diagnostic.stage}:${diagnostic.cause instanceof Error
			? diagnostic.cause.message
			: String(diagnostic.cause)}`,
	);
});
const originalWindowOpen = parsedWindow.open;
let manualChallengeOpened = 0;
let manualChallengeClosed = 0;
let manualChallengeOpenedHref = '';
const { document: challengeDocument } = parseHTML(
	'<!doctype html><html><head><title>LINUX DO</title></head>' +
	'<body><main id="main-outlet"></main></body></html>',
);
let challengeHref = 'https://linux.do/';
let challengeContentType = 'text/html';
Object.defineProperty(challengeDocument, 'contentType', {
	configurable: true,
	get: () => challengeContentType,
});
Object.defineProperty(parsedWindow, 'open', {
	configurable: true,
	value: (url: string) => {
		manualChallengeOpened += 1;
		manualChallengeOpenedHref = url;
		return {
			closed: false,
			document: challengeDocument,
			location: {
				get href() {
					return challengeHref;
				},
				set href(value: string) {
					challengeHref = value;
					challengeContentType = 'application/json';
				},
			},
			focus() {},
			close() {
				manualChallengeClosed += 1;
			},
		} as unknown as Window;
	},
});
assert(
	await application.start() === 'running',
	`应用必须原子创建浏览器 Reader 运行时：${applicationDiagnostics.join(';')}`,
);
assert(runtime !== null, '浏览器 stage 必须暴露唯一运行时');
assert(
	nativeAjaxObservationState() === '2/2/0',
	'application 必须只安装一次具名宿主 Ajax 观察器',
);
const manualChallengeLink = document.querySelector<HTMLAnchorElement>(
	'.ldp-rate-limit-challenge',
)!;
const manualChallengeNotice = document.querySelector<HTMLElement>(
	'.ldp-rate-limit-notice',
)!;
const manualChallengeUrl = new URL(manualChallengeLink.href);
assert(
	manualChallengeUrl.pathname === '/challenge' &&
		decodeURIComponent(
			manualChallengeUrl.searchParams.get('redirect') ?? '',
		) === 'https://linux.do/',
	'人工入口必须使用站点原生 GET challenge，并为原生导航保留安全回跳',
);
const challengeRuntime = runtime as ReaderBrowserRuntime<TestTopic, TestPost>;
await challengeRuntime.permit.noteCloudflareChallenge({
	href: 'https://linux.do/t/10.json',
});
await challengeRuntime.rateLimitNotice.refresh();
assert(
	!manualChallengeNotice.hidden,
	'人工过盾前必须显示 Cloudflare 硬闸门提示',
);
challengeVerificationRateLimited = true;
const manualChallengeNativeNavigation = manualChallengeLink.dispatchEvent(
	new parsedWindow.Event('click', {
		bubbles: true,
		cancelable: true,
	}),
);
await new Promise((resolve) => setTimeout(resolve, 280));
challengeVerificationRateLimited = false;
assert(
	!manualChallengeNativeNavigation &&
		manualChallengeOpened === 0 &&
		manualChallengeOpenedHref === '' &&
		manualChallengeClosed === 0 &&
		(await challengeRuntime.permit.snapshot()).challengeState === 'passed' &&
		manualChallengeNotice.hidden,
	'普通 429 不得冒充未过盾；原生探针已确认通行时必须零开窗解闸并立即隐藏提示',
);
Object.defineProperty(parsedWindow, 'open', {
	configurable: true,
	value: originalWindowOpen,
});
assert(
	settingsController !== null,
	'可写偏好 repository 必须在 browser stage 创建唯一 Settings controller',
);
assert(
	settingsView !== null &&
		layoutStyle !== null &&
		document.querySelectorAll('.ldp-settings-toggle').length === 1 &&
		document.querySelectorAll('.ldp-settings-popover').length === 1,
	'可写设置必须由 browser stage 同时创建唯一 Settings View 和 Shell 入口',
);
const shellRoot = document.querySelector<HTMLElement>('.ldp-overlay')!;
assert(
	document.querySelectorAll('[data-layout-region]').length === 5 &&
		shellRoot.style.getPropertyValue('--ldp-layout-main') === '88%',
	'显式 layout adapter 必须创建唯一模式投影和 layout form',
);
assert(
	appearanceStyle !== null &&
		document.querySelectorAll('[data-appearance-setting]').length === 13 &&
		shellRoot.style.getPropertyValue('--ldp-reply-line-color') ===
			'#6dab85',
	'显式 appearance adapter 必须创建唯一主题投影和 appearance form',
);
assert(
	fontStyle !== null &&
		document.querySelectorAll('[data-font-setting]').length === 25 &&
		shellRoot.style.getPropertyValue('--ldp-post-font-size') ===
			'13.3px' &&
		document.documentElement.dataset.ldpFontRendering === 'builtin',
	'显式 font adapter 必须创建唯一字体投影和 font form',
);
(settingsView as ReaderSettingsView<TestPreferences>).open('performance');
assert(
	(settingsView as ReaderSettingsView<TestPreferences>).snapshot.open &&
		(settingsView as ReaderSettingsView<TestPreferences>).snapshot
			.activePanelId === 'performance',
	'Browser runtime 设置入口必须直接复用同一个 Settings controller 状态',
);
(settingsView as ReaderSettingsView<TestPreferences>).close();
assert(
	nativeAjaxObservationState() === '2/2/0',
	'Settings/ResourceMonitor 开关不得重复安装或释放 application Ajax 观察器',
);
assert(
	shellRoot.style.getPropertyValue('--ldp-jump-highlight-color') === '#123456' &&
	shellRoot.style.getPropertyValue('--ldp-jump-highlight-duration') === '1000ms' &&
	shellRoot.style.getPropertyValue('--ldp-jump-highlight-count') === '2',
	'浏览器 stage 必须把启动偏好投到唯一 Shell 导航样式 owner',
);
const performancePageSize = document.querySelector<HTMLInputElement>(
	'[data-performance-key="pageSize"]',
)!;
performancePageSize.value = '28';
performancePageSize.dispatchEvent(
	new parsedWindow.Event('input', { bubbles: true }),
);
const settingsSave = (
	settingsController as ReaderSettingsController<TestPreferences>
).saveAll();
assert(
	settingsSave.kind === 'saved' &&
	settingsSave.count === 1 &&
	activePreferences.performancePageSize === 28 &&
	(runtime as ReaderBrowserRuntime<TestTopic, TestPost>).performance.pageSize === 28,
	'性能 form 必须经 Settings/application 唯一写端口提交，并由同一实时偏好通道热更新 runtime',
);
const layoutLeft = document.querySelector<HTMLInputElement>(
	'[data-layout-region="left"]',
)!;
layoutLeft.value = '10';
layoutLeft.dispatchEvent(
	new parsedWindow.Event('input', { bubbles: true }),
);
const layoutSave = (
	settingsController as ReaderSettingsController<TestPreferences>
).saveAll();
assert(
	layoutSave.kind === 'saved' &&
	layoutSave.count === 2 &&
	activePreferences.layoutProfile.left === 10 &&
	activePreferences.layoutProfile.main === 78 &&
	shellRoot.style.getPropertyValue('--ldp-layout-left') === '10%' &&
	shellRoot.style.getPropertyValue('--ldp-layout-main') === '78%',
	'布局 form 必须一次保存再由 layout runtime 从实时偏好接管当前 CSS',
);
activePreferences = Object.freeze({
	...initialPreferences,
	performancePageSize: 24,
	performanceStreamOverscan: 2,
	performanceStreamMaxItems: 48,
	performanceNestedPrefetch: 2,
	performanceRequestConcurrency: 1,
	performanceRequestInterval: 220,
	performanceRequestRateTarget: 50,
		jumpHighlightColor: '#abcdef',
		jumpHighlightRate: 2,
		jumpHighlightCount: 3,
		historyEdgeTriggerPercent: 0,
		historyButtonsAlwaysVisible: true,
		historySortMode: 'first-viewed',
		openTopicsAtFirstPost: true,
		translationMode: 'bilingual',
	});
preferenceChanges.emit({
	value: activePreferences,
});
assert(
	shellRoot.style.getPropertyValue('--ldp-jump-highlight-color') === '#abcdef' &&
	shellRoot.style.getPropertyValue('--ldp-jump-highlight-duration') === '500ms' &&
	shellRoot.style.getPropertyValue('--ldp-jump-highlight-count') === '3',
	'偏好提交必须原地更新 CSS/scroll 快照，不重建 Shell 或 Topic',
);
const activeRuntime = runtime as ReaderBrowserRuntime<TestTopic, TestPost>;
const permitPerformance = await activeRuntime.permit.snapshot();
assert(
	activeRuntime.performance.pageSize === 24 &&
	activeRuntime.performance.nestedPrefetchScreens === 2 &&
	activeRuntime.performance.requestMaxConcurrent === 1 &&
	activeRuntime.performance.requestShortBudget === 25 &&
	activeRuntime.data.client.scheduler.snapshot().maxConcurrent === 1 &&
	permitPerformance.maxConcurrent === 1 &&
	permitPerformance.minIntervalMs === 220 &&
	permitPerformance.shortBudget === 25 &&
	permitPerformance.longBudget === 100,
	'七个性能设置必须从同一快照热更新 loader、树预取、scheduler 与跨标签 permit',
);
assert(
		shellRoot.classList.contains('ldp-history-buttons-always-visible') &&
				activeRuntime.historyNavigationView !== null &&
				activeRuntime.historyPanelView !== null &&
				activeRuntime.notificationController !== null &&
				activeRuntime.notificationPanelView !== null &&
				activeRuntime.bookmarkController !== null &&
				activeRuntime.bookmarkPanelView !== null &&
				appEventSubscriptions.has('notifications:changed') &&
				appEventSubscriptions.has('bookmarks:changed') &&
				appEventSubscriptions.has(
					'discourse-reactions:reaction-toggled',
				) &&
				shellRoot.querySelectorAll('.ldp-notification-tab').length === 14 &&
				shellRoot.querySelectorAll('.ldp-bookmark-tab').length === 3 &&
				shellRoot.querySelector('.ldp-history-sort-toggle')
					?.getAttribute('aria-pressed') === 'true' &&
				shellRoot.querySelector<HTMLInputElement>(
					'.ldp-open-topics-first-post',
				)?.checked === true &&
				shellRoot.querySelector<HTMLAnchorElement>(
					'.ldp-about-link',
				)?.href ===
					'https://sunbigfly.github.io/awesome-linuxdo-reader/' &&
				shellRoot.querySelector('.ldp-about-version')
					?.textContent === 'v0.1.16',
	'历史、消息、收藏与回应集合必须共享唯一 application runtime、稳定 Shell 锚点和原生事件生命周期',
);
const runtimeConfirmation = activeRuntime.feedback.confirm({
	title: '运行时确认',
	message: '必须挂在唯一 Shell surface',
});
shellRoot.querySelector<HTMLButtonElement>(
	'.ldp-reader-action-cancel',
)!.click();
assert(
	await runtimeConfirmation === false,
	'浏览器 runtime 必须只创建一份可供历史/收藏/设置复用的确认 surface',
);
const opened = await activeRuntime.open(10);
assert(
	opened.status === 'opened',
	`统一运行时必须打开 Topic：${opened.status} / ${
		'cause' in opened ? String(opened.cause) : ''
	}`,
);
assert(
	opened.status === 'opened' &&
	opened.value.services.session.pageSize === 24,
	'设置更新后的新 Topic 必须直接使用当前批次大小，不能回退构造期旧值',
);
if (opened.status === 'opened') {
	const activeSession = opened.value.services.session;
	const openNative =
		shellRoot.querySelector<HTMLAnchorElement>('.ldp-open');
	assert(
		openNative?.hidden === false &&
		openNative.target === '_blank' &&
		new URL(openNative.href).searchParams.get('ldp_native') === '1',
		'Topic 打开后必须只更新稳定 Header 原生入口，并携带启动前消费的绕过标记',
	);
	assert(
		opened.value.topicSelectionQuote.toolbar.isConnected &&
			opened.value.topicSelectionQuote.imageToolbar?.isConnected === true &&
			shellRoot.querySelectorAll('.ldp-selection-toolbar').length === 2,
		'每个 active Topic 必须由同一引用 owner 装配文字/图片 toolbar，并共用 canonical session/composer',
	);
	assert(
		opened.value.topicActionRail !== null &&
			shellRoot.querySelectorAll('.ldp-topic-action-rail').length === 1 &&
			shellRoot.querySelectorAll(
				'.ldp-topic-action-rail > .ldp-topic-action-rail-post',
			).length === 1 &&
			shellRoot.querySelector(
				'.ldp-topic-action-rail .ldp-post-actions',
			)?.childElementCount !== 0,
		`主帖操作列必须投影 canonical 首帖并复用唯一 Post action renderer：${
			opened.value.topicActionRail ? 'rail' : 'no-rail'
		}/${
			shellRoot.querySelectorAll('.ldp-topic-action-rail').length
		}/${
			shellRoot.querySelectorAll(
				'.ldp-topic-action-rail > .ldp-topic-action-rail-post',
			).length
		}/${
			shellRoot.querySelector(
				'.ldp-topic-action-rail .ldp-post-actions',
			)?.childElementCount ?? -1
		}`,
	);
	opened.value.dom.flushNow();
	const railSharedIssue = shellRoot.querySelector<HTMLElement>(
		'.ldp-topic-action-rail [data-topic-shared-issue]',
	);
	assert(
		shellRoot.querySelectorAll('[data-topic-shared-issue]').length === 1 &&
			railSharedIssue &&
			railSharedIssue.querySelector<HTMLElement>(
				'.ldp-topic-shared-issue-count',
			)?.textContent === '1',
		'启用快捷操作列后必须摒弃首帖正文旧入口，只在收纳箱保留一份纯数字 canonical 操作投影',
	);
	const requestsBeforeAppearance = topicFrameRequests;
	const appearance = appearanceStyle as
		ReaderAppearanceStyleController<TestPreferences>;
	appearance.preview({
		...appearance.profile(),
		replyLineRadius: appearance.profile().replyLineRadius === 16 ? 15 : 16,
	});
	assert(
		topicFrameRequests === requestsBeforeAppearance + 1,
		'appearance 圆角变化必须通知 active Topic 的既有 frame 重派 Branch path',
	);
	appearance.clearPreview();
	activePreferences = Object.freeze({
		...activePreferences,
		performancePageSize: 32,
	});
	preferenceChanges.emit({ value: activePreferences });
	assert(
		activeRuntime.shell.activeValue?.services.session === activeSession &&
		activeSession.pageSize === 32,
		'打开 Topic 后修改性能设置必须原地更新同一 session，不能要求整体刷新',
	);
	activePreferences = Object.freeze({
		...activePreferences,
		performancePageSize: 24,
	});
	preferenceChanges.emit({ value: activePreferences });
}
await activeRuntime.translationFeature?.controller.flush();
assert(
	activeRuntime.translationFeature?.controller.mode === 'bilingual' &&
	shellRoot.querySelector('.ldp-translate-toggle') &&
	shellRoot.querySelector('.ldp-translation-text')
		?.textContent?.startsWith('运行时译文') &&
		externalTranslationCalls === 2,
	`翻译偏好必须挂入唯一 Shell 控件，并让首帧 PostView 经独立翻译任务 owner 动态同步：${
		activeRuntime.translationFeature?.controller.mode ?? 'missing'
	}/${externalTranslationCalls}/${
		shellRoot.querySelector('.ldp-translation-text')?.textContent ?? 'none'
	}/${activeRuntime.translationFeature?.controller.snapshot().queued ?? -1}/${
		shellRoot.querySelectorAll('.ldp-post').length
	}/${
		shellRoot.querySelector('.ldp-content')?.textContent ?? 'no-content'
	}`,
);
assert(
	activeRuntime.history.entry(10)?.title === 'Initial topic title' &&
	activeRuntime.historyNavigation.snapshot.activeTopicId === 10 &&
	runtimeStorage.values.has(readerAccountScopedStorageIdentity(
		READER_HISTORY_STORAGE_KEY,
		'account:test',
	).key),
	'Topic 打开必须写入账号作用域的唯一历史仓储并激活 Shell 级导航状态',
);
assert(
	opened.value.topicTimeline.snapshot.totalPostCount === 2 &&
	opened.value.topicTimeline.snapshot.currentPostNumber === 1 &&
	opened.value.topicTimelineView !== null &&
	document.querySelector<HTMLElement>('.ldp-topic-timeline')?.hidden === false &&
	document.querySelector('.ldp-topic-timeline-date')
		?.textContent?.includes('2026 年') &&
	document.querySelector('.ldp-topic-timeline-relative')
		?.textContent === '刚刚',
	'每个 Topic runtime 必须暴露一份 canonical 时间轴状态与一份稳定 Shell View',
);
assert(
	opened.value.topicHeader.snapshot.title === 'Initial topic title' &&
	shellRoot.querySelector('.ldp-title-jump')?.textContent ===
		'Initial topic title' &&
	shellRoot.querySelector('.ldp-meta-stats')?.textContent ===
		'2 帖 · 40 浏览 · 5 赞 · 2 用户' &&
	shellRoot.querySelector('.ldp-meta-owner-value')?.textContent === '@root' &&
	shellRoot.querySelectorAll('.ldp-topic-tag').length === 2,
	'Topic 打开必须把 canonical 标题、统计、楼主、分类和标签投到唯一 Shell Header owner',
);
const notificationTarget = await activeRuntime.openTarget({
	topicId: 10,
	postNumber: 2,
	source: 'notification',
	alignment: 'center',
	highlight: true,
});
assert(
	notificationTarget.topic.status === 'reused' &&
	notificationTarget.navigation?.status === 'revealed' &&
	notificationTarget.navigation.source === 'notification' &&
	opened.value.topicTimeline.snapshot.currentPostNumber === 1,
	'同 Topic 的通知/消息/初始路由必须复用 openTarget 与唯一 navigation；内容精确定位嵌套目标，时间轴只回写所属正文根楼层',
);
const captureViewportAnchor = opened.value.dom.captureViewportAnchor.bind(
	opened.value.dom,
);
Object.defineProperty(opened.value.dom, 'captureViewportAnchor', {
	configurable: true,
	value: () => ({
		postNumber: discoursePostNumber(1),
		postOffset: 37,
		scrollTop: 337,
	}),
});
const physicalHistoryAnchor = activeRuntime.historyNavigation.captureCurrent();
Object.defineProperty(opened.value.dom, 'captureViewportAnchor', {
	configurable: true,
	value: captureViewportAnchor,
});
assert(
	physicalHistoryAnchor?.viewport.postNumber === 1 &&
		physicalHistoryAnchor.viewport.postOffset === 37 &&
		physicalHistoryAnchor.viewport.scrollTop === 337,
	'历史捕获必须保留真实 DOM 锚点，不能用可能晚一帧的时间轴楼层覆盖当前视口',
);
opened.value.topicLiveNavigation.syncViewport({ atEnd: false });
opened.value.services.live.changes.emit(Object.freeze({
	kind: 'post',
	postId: discoursePostId(
		opened.value.services.session.postByNumber(2)!.id,
	),
	post: opened.value.services.session.postByNumber(2)!,
	created: true,
	wasKnown: false,
}));
assert(
	opened.value.topicLiveNavigation.snapshot.targetPostNumber === 2 &&
	opened.value.topicLiveNavigation.snapshot.pendingCount === 1 &&
	!opened.value.topicLiveNavigationView.scope.destroyed &&
	document.querySelector<HTMLElement>('.ldp-live-update')?.hidden === false,
	'运行时必须把确认的新楼层投到同一实时导航 controller/View，离开底部时不得自动滚动',
);
opened.value.topicLiveNavigation.clear();
const firstTopicImages = opened.value.topicImages;
const firstTopicImageInteraction = opened.value.topicImageInteraction;
const firstTopicLightbox = opened.value.topicLightbox;
const firstTopicMedia = opened.value.topicMedia;
const firstTopicCookedContent = opened.value.topicCookedContent;
const root = document.querySelector<HTMLElement>('[data-post-number="1"]')!;
const child = document.querySelector<HTMLElement>('[data-post-number="2"]')!;
assert(
	firstTopicImages.snapshot().items.length === 1 &&
	firstTopicImages.snapshot().items[0]?.alt === 'runtime image' &&
	topicReadyImages === 1 &&
	root.querySelector('img')?.loading === 'lazy' &&
	root.querySelector('iframe')?.getAttribute('src')?.includes('autoplay=0') &&
	root.querySelector('.ldp-callout--tip') &&
	root.querySelector('.ldp-code-block-collapsible'),
	'每个 Topic runtime 必须只创建并暴露一个 cooked/图片/媒体流水线，render 后统一准备 DOM',
);
const frameRequestsBeforeCodeExpand = topicFrameRequests;
opened.value.dom.flushNow();
root.querySelector<HTMLButtonElement>(
	'[data-reader-code-action="toggle"]',
)?.click();
const emitTopicRootSize = topicRootSizeCallback as
	| ((entries: readonly Readonly<{
		readonly target: Element;
		readonly blockSize: number;
	}>[]) => void)
	| null;
assert(emitTopicRootSize !== null, 'Topic 根尺寸 observer 未接入虚拟帧');
emitTopicRootSize(Object.freeze([Object.freeze({
	target: root,
	blockSize: 640,
})]));
assert(
	root.querySelector('.ldp-code-block-expanded') &&
		topicFrameRequests > frameRequestsBeforeCodeExpand,
	'代码块尺寸变化必须由根 ResizeObserver 回到唯一虚拟帧 owner，内容回调不得伪造滚动',
);
assert(
	opened.value.topicSpecialContent.scope.destroyed === false &&
	root.querySelector('.ldp-post-body-layer > .ldp-solved-card')
		?.querySelector('.ldp-solved-excerpt')?.textContent ===
		'child-content' &&
	!root.querySelector('.ldp-reply-tree')
		?.contains(root.querySelector('.ldp-solved-card') ?? null),
	'已解决答案必须由 Topic 唯一特殊正文 feature 放入 #1 bodyLayer，不得混入回复树或 SVG 层',
);
assert(
	topicFactoryComposer === activeRuntime.composer,
	'Topic Post features 必须只接收 application 唯一原生 composer，不能自行 lookup/构造',
);
const imageClick = new parsedWindow.Event('click', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperties(imageClick, {
	button: { value: 0 },
	altKey: { value: false },
	ctrlKey: { value: false },
	metaKey: { value: false },
	shiftKey: { value: false },
});
root.querySelector('img')!.dispatchEvent(imageClick);
await Promise.resolve();
await Promise.resolve();
assert(
	firstTopicImageInteraction &&
	imageClick.defaultPrevented &&
	firstTopicLightbox?.active?.sequence.snapshot().current.key ===
		firstTopicImages.snapshot().items[0]?.key &&
	document.querySelectorAll('.ldp-lightbox').length === 1,
	'普通/嵌套 PostView 图片必须经 Topic 唯一委托入口打开共享目录的标准 Lightbox',
);
assert(
	firstTopicLightbox?.active?.batch?.snapshot().archiveName ===
		'Initial topic title',
	'标准 Lightbox 初次打开必须读取当前 canonical Topic 标题',
);
topic10Response = refreshedTopic;
await opened.value.services.session.refresh();
firstTopicLightbox?.open({
	items: firstTopicImages.snapshot().items,
});
assert(
	firstTopicLightbox?.active?.batch?.snapshot().archiveName ===
		'Refreshed topic title' &&
	String(opened.value.topicHeader.snapshot.title) ===
		'Refreshed topic title' &&
	shellRoot.querySelector('.ldp-title-jump')?.textContent ===
		'Refreshed topic title',
	'Topic refresh 后 Lightbox 与 Header 必须共同读取最新 canonical Topic，而不是冻结初始对象',
);
assert(
	child.parentElement === root.querySelector('.ldp-reply-list'),
	'Topic JSON 的二级回复必须在首帧进入 canonical 父楼层',
);
assert(
	!opened.value.topicContext.scope.destroyed &&
	!opened.value.topicContextFeature.scope.destroyed &&
	!opened.value.topicContextSurface.scope.destroyed &&
	child.querySelector('[data-reader-context-self]')?.textContent === '#2' &&
	child.querySelector('[data-reader-context-self]')?.classList.contains(
		'ldp-current-floor',
	) &&
	!child.querySelector('[data-reader-context-parent]') &&
		!root.querySelector('[data-reader-context-discussion]'),
	'浏览器运行时必须只装配一套树关系/自身楼层/完整讨论 owner；父节点已在树上方时不得保留父预览入口',
);
await opened.value.topicContext.openDiscussion(2);
const capturedDiscussionState =
	opened.value.topicContextSurface.captureDiscussionState();
assert(
	opened.value.topicContext.snapshot().discussion?.entries.length === 1 &&
	capturedDiscussionState?.rootPostNumber === 2 &&
	shellRoot.querySelector('.ldp-descendant-replies-window [data-post-number="2"]'),
	'完整讨论必须由 runtime 唯一 context surface 投影 canonical 分支根',
);
const composerCreatedPost: TestPost = Object.freeze({
	id: 103,
	topic_id: 10,
	post_number: 3,
	reply_to_post_number: 1,
	username: 'viewer',
	can_reply: true,
	actions_summary: Object.freeze([]),
	reactions: Object.freeze([
		Object.freeze({ id: 'heart', count: 1 }),
	]),
	current_user_reaction: null,
	reaction_users_count: 1,
	cooked:
		'<p>A dynamically inserted complete English sentence.</p>' +
		'<aside class="quote" data-topic="10" data-post="1">' +
		'<div class="title">root</div>' +
		'<blockquote><p>root-content</p></blockquote></aside>',
});
appEvents.trigger('post:created', composerCreatedPost);
await Promise.resolve();
await activeRuntime.translationFeature?.controller.flush();
assert(
	opened.value.services.session.postByNumber(3) === composerCreatedPost &&
	document.querySelector('[data-post-number="3"]')?.parentElement ===
		root.querySelector('.ldp-reply-list') &&
	document.querySelector('[data-post-number="3"]')
		?.classList.contains('ldp-jump-highlight') &&
	latestHighlightLifetime === 1_500,
	'Composer 直接实体必须先提交唯一 TopicSession，再经同一个导航 owner 聚焦 canonical 子楼层',
);
assert(
	document.querySelector('[data-post-number="3"] .ldp-translation-text')
		?.textContent?.startsWith('运行时译文') &&
		Number(externalTranslationCalls) === 3,
	`实时/Composer 新 PostView 必须自动进入同一个翻译 feature，不能依赖全局 Observer 或切帖重扫：${
		externalTranslationCalls
	}/${JSON.stringify(activeRuntime.translationFeature?.controller.snapshot())}/${
		document.querySelector('[data-post-number="3"] .ldp-content')
			?.textContent ?? 'missing'
	}/${
		document.querySelector('[data-post-number="3"] .ldp-translation-text')
			?.textContent ?? 'none'
	}/${translationErrors.join('|')}`,
);
assert(
	document.querySelector('[data-post-number="3"] .ldp-replybtn') &&
	document.querySelector('[data-post-number="3"] .ldp-reaction-summary'),
	'Composer/MessageBus 后插入楼层必须经同一 PostAction feature 获得回复与回应入口',
);
const nativeCallsBeforeReactionEvent = nativeCalls.length;
appEvents.trigger('discourse-reactions:reaction-toggled', {
	post: Object.freeze({
		...opened.value.services.session.postByNumber(2)!,
		reactions: Object.freeze([
			Object.freeze({ id: 'heart', count: 2 }),
		]),
		reaction_users_count: 2,
	}),
});
await activeRuntime.applicationCacheInvalidation.flush();
assert(
	Number(
		opened.value.services.session.postByNumber(2)?.reactions?.[0]?.count,
	) === 2 &&
	document.querySelector(
		'[data-post-number="2"] ' +
			'.ldp-reaction-chip[data-reaction="heart"] b',
	)?.textContent === '2' &&
	nativeCalls.length === nativeCallsBeforeReactionEvent,
	'携带完整 Post model 的宿主回应事件必须后台直写 canonical、持久缓存与复用 DOM，不能新增请求：' +
		JSON.stringify({
			canonicalCount:
				opened.value.services.session.postByNumber(2)?.reactions?.[0]?.count,
			domCount: document.querySelector(
				'[data-post-number="2"] ' +
					'.ldp-reaction-chip[data-reaction="heart"] b',
			)?.textContent ?? null,
			nativeCallsBeforeReactionEvent,
			nativeCallsAfterReactionEvent: nativeCalls.length,
		}),
);
assert(
	Number(opened.value.topicTimeline.snapshot.totalPostCount) === 3 &&
	Number(opened.value.topicTimeline.snapshot.currentPostNumber) === 1,
	'实时新增的嵌套楼层仍须同步 canonical 总数；Composer 精确定位子楼层后，时间轴只回写所属正文根楼层',
);
document.querySelector<HTMLElement>('[data-post-number="3"]')
	?.querySelector<HTMLButtonElement>('[data-reader-context-quote="jump"]')
	?.click();
for (let index = 0; index < 4; index += 1) await Promise.resolve();
const capturedQuoteHighlight =
	opened.value.topicContextFeature.captureQuoteHighlightState();
assert(
	root.querySelector('mark.ldp-quote-match')?.textContent ===
		'root-content' &&
	capturedQuoteHighlight?.postNumber === 1,
	'运行时引用跳转必须从唯一 navigation 取得 canonical 元素并由 thread-context owner 精确高亮',
);
const deepCreatedPost: TestPost = Object.freeze({
	id: 104,
	topic_id: 10,
	post_number: 4,
	reply_to_post_number: 3,
	username: 'nested-viewer',
	can_reply: true,
	can_boost: true,
	actions_summary: Object.freeze([]),
	cooked: '<p>deep-created</p>',
	boosts: Object.freeze([Object.freeze({
		id: 404,
		raw: 'deep boost',
		cooked: '<p>deep boost</p>',
		user: Object.freeze({
			username: 'booster',
			name: 'Booster',
			avatar_template: '/avatar/{size}.png',
		}),
	})]),
});
appEvents.trigger('post:created', deepCreatedPost);
await Promise.resolve();
assert(
	document.querySelector('[data-post-number="4"] .ldp-boostbtn') &&
		document.querySelector(
			'[data-post-number="4"] .ldp-boost-list .ldp-boost-bubble',
		),
	'后插入的深层楼层必须经同一 action feature 获得 Boost 入口与 canonical Boost list',
);
const deepTarget = await activeRuntime.openTarget({
	topicId: 10,
	postNumber: 4,
	source: 'notification',
});
assert(
	deepTarget.topic.status === 'reused' &&
	opened.value.topicContext.snapshot().discussion?.rootPostNumber === 3 &&
	opened.value.topicContext.snapshot().discussion?.entries
		.some((entry) => entry.postNumber === 4),
	'消息/通知/链接命中深层楼层时必须在 canonical 导航补流后打开所属完整讨论，而不是留在隐藏正式楼层',
);
opened.value.topicContext.closeDiscussion();
opened.value.topicOnlyOp.setEnabled(true);
const mainPost4Count = (): number => [
	...shellRoot.querySelectorAll<HTMLElement>('[data-post-number="4"]'),
].filter((postRoot) =>
	!postRoot.closest('.ldp-descendant-replies-layer')
).length;
assert(
	opened.value.dom.isPostHidden(4) && mainPost4Count() === 0,
	'隐藏目标回归必须先确认楼层已从只看楼主的正式主流投影停放',
);
const hiddenDeepTarget = await activeRuntime.openTarget({
	topicId: 10,
	postNumber: 4,
	source: 'notification',
});
assert(
	hiddenDeepTarget.navigation?.status === 'revealed' &&
		hiddenDeepTarget.navigation.element?.closest(
			'.ldp-descendant-replies-layer',
		) !== null &&
		opened.value.topicContext.snapshot().discussion?.rootPostNumber === 3 &&
		opened.value.dom.replyTreePresentation.rootOf(4) === undefined &&
		mainPost4Count() === 0,
	'跳转到当前投影隐藏的楼层时，必须只在完整讨论内定位，不能把目标插回正式楼层造成双重结构',
);
opened.value.topicOnlyOp.setEnabled(false);
const topicNativeCall = nativeCalls.find((call) => call.path.startsWith('/t/10.json?'));
assert(
	topicNativeCall?.options.type === 'GET' &&
	nativeAjaxLookups === 1,
	'浏览器运行时的 Topic 读取必须只解析并调用一次 Discourse 原生 ajax',
);
assert(
	subscriptions.has('/topic/10') && subscriptions.has('/topic/10/reactions'),
	'浏览器运行时必须只使用 Discourse 原生 MessageBus 订阅',
);
assert(
	(
		await activeRuntime.translationRequests!.translate(
			['A separate manual runtime translation sentence.'],
			new AbortController().signal,
		)
	)[0] === '运行时译文' &&
		Number(externalTranslationCalls) === 4,
	'翻译必须使用 application 级独立后台任务 owner，且不能混入 Discourse 原生端口',
);
opened.value.topicContext.closeDiscussion();
opened.value.topicLightbox?.close();
assert(
	!activeRuntime.readerSurfaceOpen(),
	'原生浮层门禁反例开始前必须先关闭上一场景遗留的完整讨论和 Lightbox surface',
);
const nativeFloatingMenu = document.createElement('div');
nativeFloatingMenu.className = 'fk-d-menu';
Object.defineProperty(nativeFloatingMenu, 'getBoundingClientRect', {
	configurable: true,
	value: () => ({
		x: 20,
		y: 20,
		left: 20,
		top: 20,
		right: 180,
		bottom: 100,
		width: 160,
		height: 80,
		toJSON() {},
	}),
});
document.body.append(nativeFloatingMenu);
assert(
	activeRuntime.readerSurfaceOpen() && activeRuntime.readerExitBlocked(),
	'可见 Discourse 原生 fk-d-menu 必须进入 Reader 退出门禁，不能被全局 Esc 抢先关掉 Reader',
);
nativeFloatingMenu.hidden = true;
assert(
	!activeRuntime.readerSurfaceOpen() && !activeRuntime.readerExitBlocked(),
	'仅存在但已隐藏的原生浮层不得误阻塞 Reader 退出',
);
nativeFloatingMenu.remove();
const portal = document.createElement('div');
portal.dataset.ldpReaderPortal = 'mian-lite-test';
document.body.append(portal);
const portalRoot = portal.attachShadow({ mode: 'open' });
const shadowSettings = document.createElement('div');
shadowSettings.className = 'ldp-settings-popover';
portalRoot.append(shadowSettings);
assert(
	activeRuntime.readerSurfaceOpen() &&
		activeRuntime.readerExitBlocked() &&
		activeRuntime.readerShortcutContextBlocked(),
	'open ShadowRoot 内的设置/灯箱等 surface 必须进入 Reader 退出与快捷键门禁，Esc 不能穿透关闭 Reader',
);
portal.remove();
const customShortcutSurface = document.createElement('div');
customShortcutSurface.className = 'ldp-reaction-picker';
document.body.append(customShortcutSurface);
let forwardedSurfaceEscapes = 0;
const closeCustomShortcutSurface = (event: Event): void => {
	if (
		(event as KeyboardEvent).key !== 'Escape' ||
		!customShortcutSurface.isConnected
	) return;
	forwardedSurfaceEscapes += 1;
	event.preventDefault();
	event.stopImmediatePropagation();
	customShortcutSurface.remove();
};
document.addEventListener('keydown', closeCustomShortcutSurface);
const customCloseShortcut = new parsedWindow.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(customCloseShortcut, 'code', {
	configurable: true,
	value: 'KeyQ',
});
assert(
	activeRuntime.handleCloseReaderShortcut(customCloseShortcut) === true &&
		forwardedSurfaceEscapes === 1 &&
		!activeRuntime.shell.view.root.hidden,
	'自定义关闭快捷键必须复用顶层 surface 的 Escape owner，只关闭一层且不得直接退出 Reader',
);
const blockedShortcutSurface = document.createElement('div');
blockedShortcutSurface.className = 'ldp-settings-popover';
document.body.append(blockedShortcutSurface);
const blockedCustomClose = new parsedWindow.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(blockedCustomClose, 'code', {
	configurable: true,
	value: 'KeyQ',
});
assert(
	activeRuntime.handleCloseReaderShortcut(blockedCustomClose) === false &&
		forwardedSurfaceEscapes === 1,
	'main 明确屏蔽的 Settings/Action/Lightbox/Code 上下文不得被自定义关闭快捷键穿透',
);
blockedShortcutSurface.remove();
document.removeEventListener('keydown', closeCustomShortcutSurface);
const runtimeUserAnchor = document.createElement('button');
runtimeUserAnchor.textContent = '运行时用户';
activeRuntime.shell.view.surfaceHost.append(runtimeUserAnchor);
await activeRuntime.userCardView.open('runtime-user', runtimeUserAnchor);
const runtimeViewer = activeRuntime.userMediaViewer?.open({
	item: Object.freeze({
		key: 'runtime:user-avatar',
		topicId: 10,
		sourcePostNumber: 1,
		imageOrder: 0,
		previewSrc: 'https://linux.do/avatar/runtime-user.png',
		originalSrc: 'https://linux.do/avatar/runtime-user.png',
		alt: '运行时用户头像',
	}),
	kind: 'avatar',
	anchor: runtimeUserAnchor,
	outsideSafeSurface: activeRuntime.userCardView.element,
});
const pendingRuntimeSurface = activeRuntime.feedback.confirm({
	title: '运行时关闭',
	message: '关闭 Reader 必须释放应用级 surface',
});
assert(
	activeRuntime.workspace.setMode('embed-right'),
	'关闭回归必须先进入列表嵌入态',
);
assert(
	activeRuntime.readerSurfaceOpen() &&
	activeRuntime.userCardView.isOpen &&
		activeRuntime.users.activeUsername === 'runtime-user' &&
		runtimeViewer?.isConnected &&
		activeRuntime.actionSurfaces.active,
	'应用级用户卡、紧凑查看器和动作弹层必须纳入统一顶层 surface 门禁',
);
const latestTimelinePostNumberBeforeClose =
	activeRuntime.shell.activeValue?.topicTimeline.snapshot.currentPostNumber;
const runtimeClose = activeRuntime.close();
assert(
	activeRuntime.shell.view.root.hidden &&
		!activeRuntime.readerSurfaceOpen() &&
		!activeRuntime.userCardView.isOpen &&
		String(activeRuntime.users.activeUsername) === '' &&
		activeRuntime.userMediaViewer?.activeRoot === null &&
		!activeRuntime.actionSurfaces.active,
	`关闭意图必须同步隐藏 Shell，并在等待持久化前释放全部应用级 surface：${JSON.stringify({
		rootHidden: activeRuntime.shell.view.root.hidden,
		readerSurfaceOpen: activeRuntime.readerSurfaceOpen(),
		userCardOpen: activeRuntime.userCardView.isOpen,
		activeUsername: activeRuntime.users.activeUsername,
		viewerOpen: activeRuntime.userMediaViewer?.activeRoot !== null,
		actionSurfaceOpen: activeRuntime.actionSurfaces.active,
	})}`,
);
assert(
	await runtimeClose && await pendingRuntimeSurface === false,
	'统一运行时必须完成 Topic 关闭事务并取消悬挂的 surface Promise',
);
assert(
	activeRuntime.shell.state === 'closed' &&
	activeRuntime.shell.activeTopicId === null &&
	activeRuntime.workspace.workspace.snapshot.requestedMode === 'embed-right' &&
	activeRuntime.workspace.workspace.snapshot.presentation.mode === 'floating' &&
	!document.documentElement.classList.contains('ldp-reader-workspace') &&
	!document.documentElement.classList.contains('ldp-reader-embedded-right'),
	'嵌入态关闭必须真正关闭 Reader、撤销宿主分栏，同时保留下一次打开要恢复的模式',
);
const storedHistoryAfterClose = JSON.parse(
	runtimeStorage.values.get(readerAccountScopedStorageIdentity(
		READER_HISTORY_STORAGE_KEY,
		'account:test',
	).key) ?? '[]',
) as readonly Readonly<{ topicId: number; postNumber: number }>[];
assert(
	latestTimelinePostNumberBeforeClose !== undefined &&
	activeRuntime.history.entry(10)?.postNumber ===
		latestTimelinePostNumberBeforeClose &&
		storedHistoryAfterClose.find((entry) => entry.topicId === 10)
			?.postNumber === latestTimelinePostNumberBeforeClose,
	'关闭 Topic 必须把唯一时间轴的最新楼层同步到内存与持久历史',
);
assert(
	nativeCalls.some((call) => call.path === '/topics/timings') &&
		subscriptions.size === 0 &&
		firstTopicImages.scope.destroyed &&
		firstTopicImageInteraction.scope.destroyed &&
		firstTopicLightbox?.scope.destroyed &&
		firstTopicMedia.scope.destroyed &&
		firstTopicCookedContent.scope.destroyed &&
		opened.value.topicHeader.scope.destroyed &&
		opened.value.topicHeaderView.scope.destroyed &&
		opened.value.topicSpecialContent.scope.destroyed &&
		opened.value.topicContext.scope.destroyed &&
		opened.value.topicContextFeature.scope.destroyed &&
		opened.value.topicContextSurface.scope.destroyed &&
		opened.value.topicNavigation.scope.destroyed &&
		opened.value.topicTimelineView?.scope.destroyed &&
		opened.value.topicLiveNavigationView.scope.destroyed &&
		opened.value.topicActionRail?.scope.destroyed &&
		!shellRoot.querySelector('.ldp-topic-action-rail') &&
		appEventSubscriptions.size === 6 &&
		appEventSubscriptions.has('notifications:changed') &&
		appEventSubscriptions.has('bookmarks:changed') &&
		appEventSubscriptions.has(
			'discourse-reactions:reaction-toggled',
		) &&
		appEventSubscriptions.has('composer:created-post') &&
		appEventSubscriptions.has('composer:edited-post') &&
		appEventSubscriptions.has('post:created'),
	'关闭事务必须经原生 timings 提交已读、退订 Topic app-events 并释放导航/时间轴/实时提示/主帖操作列/图片/Lightbox/媒体 owner；application 通知、收藏与任意 Topic cache invalidation 订阅必须跨切帖保留',
);
assert(
	activeRuntime.history.entry(10)?.readPostNumbers.includes(
		discoursePostNumber(2),
	) === true,
	'Topic prepareClose 完成 timings flush 后必须把唯一 ReadState confirmed 集合汇入历史，不能只依赖初始 post.read',
);
const openedNextTarget = await activeRuntime.openTarget({
	topicId: 11,
	postNumber: 1,
	source: 'quote',
	alignment: 'nearest',
	highlight: false,
	forceRefresh: true,
	quoteHighlight: Object.freeze({
		postNumber: discoursePostNumber(1),
		text: 'next-content',
		active: true,
		source: Object.freeze({
			topicId: discourseTopicId(10),
			postNumber: discoursePostNumber(3),
			parentPostNumber: discoursePostNumber(1),
			nested: false,
			anchor: Object.freeze({
				viewport: physicalHistoryAnchor.viewport,
				replyWindow: capturedDiscussionState,
				quoteHighlight: null,
			}),
		}),
	}),
});
const openedNext = openedNextTarget.topic;
assert(
	openedNext.status === 'opened' &&
	openedNextTarget.navigation?.status === 'revealed' &&
	shellRoot.querySelector('[data-post-number="1"] mark.ldp-quote-match')
		?.textContent === 'next-content' &&
	!shellRoot.querySelector('[data-post-number="1"]')
		?.classList.contains('ldp-jump-highlight') &&
	String(activeRuntime.workspace.workspace.snapshot.presentation.mode) ===
		'embed-right' &&
	openedNext.value.topicImages !== firstTopicImages &&
	nativeCalls.some((call) => call.path.startsWith('/t/11.json?')) &&
		nativeAjaxLookups === 1,
	`跨 Topic 引用必须重开 Reader、定位正确楼层、将匹配摘录滚入视野且不误闪整个楼层：${JSON.stringify({
		status: openedNext.status,
		navigation: openedNextTarget.navigation?.status,
		match: shellRoot.querySelector('[data-post-number="1"] mark.ldp-quote-match')
			?.textContent,
		floorHighlight: shellRoot.querySelector('[data-post-number="1"]')
			?.classList.contains('ldp-jump-highlight'),
		mode: activeRuntime.workspace.workspace.snapshot.presentation.mode,
		imagesChanged: openedNext.status === 'opened' &&
			openedNext.value.topicImages !== firstTopicImages,
		topicRequest: nativeCalls.some((call) => call.path.startsWith('/t/11.json?')),
		nativeAjaxLookups,
	})}`,
);
const crossTopicQuoteReturn = shellRoot.querySelector<HTMLButtonElement>(
	'.ldp-quote-highlight-return',
);
assert(
	crossTopicQuoteReturn?.textContent === '返回引用楼层',
	'跨 Topic 引用高亮必须显示明确的返回引用处入口',
);
const changedQuoteTarget = await activeRuntime.openTarget({
	topicId: 11,
	postNumber: 1,
	source: 'quote',
	alignment: 'nearest',
	highlight: false,
	forceRefresh: true,
	quoteHighlight: Object.freeze({
		postNumber: discoursePostNumber(1),
		text: 'stale quoted content',
		active: true,
		source: null,
	}),
});
const changedQuoteFeedback = shellRoot.querySelector(
	'.ldp-selection-toast',
)?.textContent ?? '';
assert(
	(changedQuoteTarget.topic.status === 'opened' ||
		changedQuoteTarget.topic.status === 'reused') &&
	changedQuoteTarget.navigation?.status === 'revealed' &&
	shellRoot.querySelector('[data-post-number="1"]')
		?.classList.contains('ldp-jump-highlight') &&
	!shellRoot.querySelector('[data-post-number="1"] mark.ldp-quote-match') &&
	changedQuoteFeedback.includes(
		'目的地内容已修改；已定位到楼层 #1',
	),
	'跨 Topic 引用文字失配时必须保留正确楼层与楼层高亮，并明确提示目的地内容已修改',
);
activeRuntime.workspace.setMode('floating');
assert(
	activeRuntime.historyNavigation.snapshot.back.some(
		(topicId) => Number(topicId) === 10,
	),
	'普通切帖必须保留刚离开的 Topic 历史顺序，不能由新 Topic 重建时丢失',
);
activeRuntime.historyNavigation.setAnchor(10, {
	viewport: {
		postNumber: 2,
		postOffset: 0,
		scrollTop: 0,
	},
	replyWindow: capturedDiscussionState,
	quoteHighlight: capturedQuoteHighlight,
});
await activeRuntime.userCardView.open('runtime-user', runtimeUserAnchor);
activeRuntime.userMediaViewer?.open({
	item: Object.freeze({
		key: 'runtime:switch-avatar',
		topicId: 11,
		sourcePostNumber: 1,
		imageOrder: 0,
		previewSrc: 'https://linux.do/avatar/runtime-switch.png',
		originalSrc: 'https://linux.do/avatar/runtime-switch.png',
		alt: '切帖用户头像',
	}),
	kind: 'avatar',
	anchor: runtimeUserAnchor,
	outsideSafeSurface: activeRuntime.userCardView.element,
});
const switchSurface = activeRuntime.feedback.confirm({
	title: '切帖 surface',
	message: '切帖必须释放旧 Topic 上方应用层',
});
const restoredHistory = await activeRuntime.historyNavigation.navigate('back');
assert(
	restoredHistory.status === 'restored' &&
	activeRuntime.shell.activeTopicId === 10 &&
	activeRuntime.shell.activeValue?.topicTimeline.snapshot.currentPostNumber === 2 &&
	activeRuntime.shell.activeValue?.topicContext.snapshot().discussion
		?.rootPostNumber === 2 &&
	activeRuntime.shell.activeValue?.topicContextFeature
		.captureQuoteHighlightState()?.postNumber === 1 &&
	activeRuntime.shell.view.root.querySelector(
		'[data-post-number="1"] mark.ldp-quote-match',
	) &&
	activeRuntime.historyNavigation.snapshot.forward.some(
		(topicId) => Number(topicId) === 11,
	),
	`历史后退必须复用 Shell open、Topic navigation 与根布局恢复子楼层，并维护唯一 forward 栈：${JSON.stringify({
		status: restoredHistory.status,
		activeTopicId: activeRuntime.shell.activeTopicId,
		currentPostNumber:
			activeRuntime.shell.activeValue?.topicTimeline.snapshot.currentPostNumber,
		discussionRoot:
			activeRuntime.shell.activeValue?.topicContext.snapshot().discussion
				?.rootPostNumber,
		quoteHighlight:
			activeRuntime.shell.activeValue?.topicContextFeature
				.captureQuoteHighlightState()?.postNumber,
		forward: activeRuntime.historyNavigation.snapshot.forward,
	})}`,
);
assert(
	!activeRuntime.userCardView.isOpen &&
		String(activeRuntime.users.activeUsername) === '' &&
		activeRuntime.userMediaViewer?.activeRoot === null &&
		!activeRuntime.actionSurfaces.active &&
		await switchSurface === false,
	'历史切帖必须经 Shell switching 边界释放 UserCard、viewer、identity 与 action surface',
);
const restoredActive = activeRuntime.shell.activeValue!;
restoredActive.topicOnlyOp.setEnabled(true);
topic10Response = rebuiltTopic;
const callsBeforeHeaderRefresh = nativeCalls.length;
const refreshTopicButton = shellRoot.querySelector<HTMLButtonElement>(
	'.ldp-reader-refresh',
)!;
let refreshClickBubbles = 0;
shellRoot.addEventListener('click', () => {
	refreshClickBubbles += 1;
});
refreshTopicButton.click();
assert(
	refreshTopicButton.disabled &&
	refreshTopicButton.classList.contains('is-refreshing') &&
	refreshTopicButton.getAttribute('aria-busy') === 'true' &&
	refreshClickBubbles === 0,
	'顶部刷新必须立即进入共享 pending 状态，阻止按钮和快捷键重复触发第二个事务',
);
for (
	let turn = 0;
	turn < 2_000 && refreshTopicButton.hasAttribute('aria-busy');
	turn += 1
) {
	await new Promise((resolve) => setTimeout(resolve, 1));
}
const headerRefreshCalls = nativeCalls.slice(callsBeforeHeaderRefresh);
assert(
	activeRuntime.shell.activeTopicId === 10 &&
		activeRuntime.shell.activeValue !== restoredActive &&
		restoredActive.topicHeader.scope.destroyed &&
		activeRuntime.shell.activeValue?.topicHeader.snapshot.title ===
			'Rebuilt topic title' &&
		activeRuntime.shell.activeValue?.topicOnlyOp.snapshot.enabled &&
		activeRuntime.shell.activeValue?.topicTimeline.snapshot
			.currentPostNumber === 1 &&
		activeRuntime.shell.activeValue?.topicContext.snapshot().discussion
			?.rootPostNumber === 2 &&
		headerRefreshCalls.filter((call) =>
			call.path.startsWith('/t/10.json?track_visit=true')).length === 1 &&
		!headerRefreshCalls.some((call) => [
			'/posts/by_number/10/1.json',
			'/posts/by_number/10/2.json',
			'/t/topic/10/2.json',
			'/t/topic/10.json?post_number=2',
			'/t/10.json?post_number=2',
		].includes(call.path)) &&
		!refreshTopicButton.disabled &&
		!refreshTopicButton.classList.contains('is-refreshing') &&
		!refreshTopicButton.hasAttribute('aria-busy'),
	`顶部刷新必须复用清缓存、关闭、强制重开与历史恢复事务，保留完整讨论和只看楼主状态，并把隐藏的当前楼层归一到楼主：${JSON.stringify({
		activeTopicId: activeRuntime.shell.activeTopicId,
		rebuilt: activeRuntime.shell.activeValue !== restoredActive,
		oldDestroyed: restoredActive.topicHeader.scope.destroyed,
		title: activeRuntime.shell.activeValue?.topicHeader.snapshot.title,
		onlyOp: activeRuntime.shell.activeValue?.topicOnlyOp.snapshot.enabled,
		currentPostNumber: activeRuntime.shell.activeValue?.topicTimeline.snapshot
			.currentPostNumber,
		discussionRoot: activeRuntime.shell.activeValue?.topicContext.snapshot()
			.discussion?.rootPostNumber,
		requestPaths: headerRefreshCalls.map((call) => call.path),
		disabled: refreshTopicButton.disabled,
		refreshing: refreshTopicButton.classList.contains('is-refreshing'),
		busy: refreshTopicButton.getAttribute('aria-busy'),
	})}`,
);
const recoveredOpen = await activeRuntime.open(12);
assert(
	recoveredOpen.status === 'opened' &&
		topic12Attempts === 3 &&
		JSON.stringify(openRetryDelays) === JSON.stringify([1_000, 2_000]) &&
		!activeRuntime.recovery.visible &&
		activeRuntime.shell.activeTopicId === 12,
	`暂时网络失败必须只按 1 秒、2 秒有界退避两次并复用同一 Shell 打开事务：${JSON.stringify({
		status: recoveredOpen.status,
		topic12Attempts,
		openRetryDelays,
		activeTopicId: activeRuntime.shell.activeTopicId,
	})}`,
);
const delaysBefore408 = openRetryDelays.length;
const recovered408 = await activeRuntime.open(14);
assert(
	recovered408.status === 'opened' &&
		topic14Attempts === 3 &&
		JSON.stringify(openRetryDelays.slice(delaysBefore408)) ===
			JSON.stringify([1_000, 2_000]) &&
		activeRuntime.shell.activeTopicId === 14,
	`HTTP 408 必须作为瞬态打开故障进入同一有界恢复链：${JSON.stringify({
		status: recovered408.status,
		topic14Attempts,
		delays: openRetryDelays.slice(delaysBefore408),
	})}`,
);
const navigationOwner = activeRuntime.shell.activeValue!.topicNavigation;
const originalNavigate = navigationOwner.navigate.bind(navigationOwner);
let navigationAttempts = 0;
let unresolvedNavigationResponses = 2;
Object.defineProperty(navigationOwner, 'navigate', {
	configurable: true,
	value: async (
		request: Parameters<typeof originalNavigate>[0],
	): Promise<ReaderTopicNavigationResult> => {
		navigationAttempts += 1;
		if (unresolvedNavigationResponses > 0) {
			unresolvedNavigationResponses -= 1;
			return Object.freeze({
				postNumber: discoursePostNumber(request.postNumber),
				source: request.source,
				status: 'unresolved-tree',
				rootPostNumber: null,
				mounted: false,
			});
		}
		return originalNavigate(request);
	},
});
const delaysBeforeNavigation = openRetryDelays.length;
const recoveredNavigation = await activeRuntime.openTarget({
	topicId: 14,
	postNumber: 1,
	source: 'notification',
});
assert(
	recoveredNavigation.topic.status === 'reused' &&
		recoveredNavigation.navigation?.status === 'revealed' &&
		navigationAttempts === 3 &&
		JSON.stringify(openRetryDelays.slice(delaysBeforeNavigation)) ===
			JSON.stringify([1_000, 2_000]),
		`canonical 回复树暂未解析时必须只重试 navigation，并复用已打开 Topic：${JSON.stringify({
			topic: recoveredNavigation.topic.status,
			navigation: recoveredNavigation.navigation?.status,
			navigationAttempts,
			delays: openRetryDelays.slice(delaysBeforeNavigation),
		})}`,
);
navigationAttempts = 0;
unresolvedNavigationResponses = 3;
const delaysBeforeUnresolvedNavigation = openRetryDelays.length;
const unresolvedNavigation = await activeRuntime.openTarget({
	topicId: 14,
	postNumber: 1,
	source: 'notification',
});
const unresolvedNavigationFeedback = shellRoot.querySelector(
	'.ldp-selection-toast',
)?.textContent ?? '';
assert(
	unresolvedNavigation.topic.status === 'reused' &&
		unresolvedNavigation.navigation?.status === 'unresolved-tree' &&
		navigationAttempts === 3 &&
		JSON.stringify(openRetryDelays.slice(delaysBeforeUnresolvedNavigation)) ===
			JSON.stringify([1_000, 2_000]) &&
		unresolvedNavigationFeedback.includes('回复树暂未完成挂载'),
	`回复树连续未解析时必须有界重试、保留结构化结果并显示降级提示：${JSON.stringify({
		topic: unresolvedNavigation.topic.status,
		navigation: unresolvedNavigation.navigation?.status,
		navigationAttempts,
		delays: openRetryDelays.slice(delaysBeforeUnresolvedNavigation),
		feedback: unresolvedNavigationFeedback,
	})}`,
);
let legacyLayoutErrorAttempts = 0;
Object.defineProperty(navigationOwner, 'navigate', {
	configurable: true,
	value: async () => {
		legacyLayoutErrorAttempts += 1;
		throw new Error('目标楼层布局稳定校验失败');
	},
});
const delaysBeforeLegacyLayoutError = openRetryDelays.length;
const legacyLayoutFailure = await activeRuntime.openTarget({
	topicId: 14,
	postNumber: 1,
	source: 'notification',
});
assert(
	legacyLayoutFailure.topic.status === 'reused' &&
		legacyLayoutFailure.navigation === null &&
		legacyLayoutErrorAttempts === 1 &&
		openRetryDelays.length === delaysBeforeLegacyLayoutError,
	`旧版布局错误文案不得再驱动 Lite 重试；异常应降级并保留已打开 Topic：${JSON.stringify({
		topic: legacyLayoutFailure.topic.status,
		navigation: legacyLayoutFailure.navigation,
		legacyLayoutErrorAttempts,
		delaysAdded: openRetryDelays.length - delaysBeforeLegacyLayoutError,
	})}`,
);
Object.defineProperty(navigationOwner, 'navigate', {
	configurable: true,
	value: originalNavigate,
});
const failedSwitch = await activeRuntime.open(15);
assert(
	failedSwitch.status === 'failed' &&
		topic15Attempts === 3 &&
		activeRuntime.shell.activeTopicId === 14 &&
		String(activeRuntime.shell.activeValue?.topicHeader.snapshot.title) ===
			'Request timeout recovered topic' &&
		!activeRuntime.recovery.visible,
	`新 Topic 最终失败必须重新装配并恢复原 active Topic，而不是留下空壳或覆盖恢复页：${JSON.stringify({
		failedStatus: failedSwitch.status,
		topic15Attempts,
		activeTopicId: activeRuntime.shell.activeTopicId,
		recoveryVisible: activeRuntime.recovery.visible,
	})}`,
);
const refreshFailureActive = activeRuntime.shell.activeValue!;
const refreshFailureAttemptsBefore = topic14Attempts;
topic14RefreshFailure = true;
refreshTopicButton.click();
for (
	let turn = 0;
	turn < 2_000 && refreshTopicButton.hasAttribute('aria-busy');
	turn += 1
) {
	await new Promise((resolve) => setTimeout(resolve, 1));
}
topic14RefreshFailure = false;
assert(
	activeRuntime.shell.activeTopicId === 14 &&
	activeRuntime.shell.activeValue !== refreshFailureActive &&
	refreshFailureActive.topicHeader.scope.destroyed &&
	String(activeRuntime.shell.activeValue?.topicHeader.snapshot.title) ===
		'Request timeout recovered topic' &&
	topic14Attempts - refreshFailureAttemptsBefore === 3 &&
	!activeRuntime.recovery.visible &&
	!refreshTopicButton.disabled &&
	!refreshTopicButton.hasAttribute('aria-busy'),
	`当前 Topic 清缓存后的强制刷新最终失败时，必须从关闭前快照恢复 Reader，不能留下空壳：${JSON.stringify({
		activeTopicId: activeRuntime.shell.activeTopicId,
		rebuilt: activeRuntime.shell.activeValue !== refreshFailureActive,
		oldDestroyed: refreshFailureActive.topicHeader.scope.destroyed,
		title: activeRuntime.shell.activeValue?.topicHeader.snapshot.title,
		requestAttempts: topic14Attempts - refreshFailureAttemptsBefore,
		recoveryVisible: activeRuntime.recovery.visible,
		disabled: refreshTopicButton.disabled,
		busy: refreshTopicButton.getAttribute('aria-busy'),
	})}`,
);
const firstConcurrentTarget = activeRuntime.openTarget({
	topicId: 13,
	postNumber: 1,
	source: 'link',
});
await Promise.resolve();
const latestConcurrentTarget = activeRuntime.openTarget({
	topicId: 13,
	postNumber: 2,
	source: 'notification',
});
topic13Gate.resolve(topic13);
const [supersededTarget, currentTarget] = await Promise.all([
	firstConcurrentTarget,
	latestConcurrentTarget,
]);
assert(
	supersededTarget.topic.status === 'superseded' &&
		(currentTarget.topic.status === 'opened' ||
			currentTarget.topic.status === 'reused') &&
		currentTarget.navigation?.postNumber === 2 &&
		activeRuntime.shell.activeTopicId === 13 &&
		activeRuntime.shell.activeValue?.topicTimeline.snapshot
			.currentPostNumber === 1,
	`同 Topic 打开中发生新目标跳转时，旧事务必须停止导航与历史提交：${JSON.stringify({
		oldStatus: supersededTarget.topic.status,
		newStatus: currentTarget.topic.status,
		newNavigation: currentTarget.navigation?.status,
		currentPostNumber:
			activeRuntime.shell.activeValue?.topicTimeline.snapshot
				.currentPostNumber,
	})}`,
);
const activeBeforeCategoryClear = activeRuntime.shell.activeValue!;
const topic13CallsBeforeCategoryClear = nativeCalls.filter((call) =>
	call.path.startsWith('/t/13.json?track_visit=true')).length;
(settingsView as ReaderSettingsView<TestPreferences>).open('cache');
for (const category of ['topics', 'users', 'notifications', 'responses', 'assets']) {
	const input = document.querySelector<HTMLInputElement>(
		`.ldp-cache-select[value="${category}"]`,
	)!;
	input.checked = true;
	input.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
}
const clearCachesButton = document.querySelector<HTMLButtonElement>(
	'.ldp-cache-clear',
)!;
clearCachesButton.click();
for (
	let turn = 0;
	turn < 2_000 && clearCachesButton.disabled;
	turn += 1
) {
	await new Promise((resolve) => setTimeout(resolve, 1));
}
const topic13CallsAfterCategoryClear = nativeCalls.filter((call) =>
	call.path.startsWith('/t/13.json?track_visit=true')).length;
assert(
	activeRuntime.shell.activeTopicId === 13 &&
	activeRuntime.shell.activeValue !== activeBeforeCategoryClear &&
	activeBeforeCategoryClear.topicHeader.scope.destroyed &&
	topic13CallsAfterCategoryClear === topic13CallsBeforeCategoryClear + 1,
	`清理帖子缓存时必须先结束并重建当前 Topic，不能让旧 TopicSession 在失效后把快照重新写回：${JSON.stringify({
		activeTopicId: activeRuntime.shell.activeTopicId,
		rebuilt: activeRuntime.shell.activeValue !== activeBeforeCategoryClear,
		oldDestroyed: activeBeforeCategoryClear.topicHeader.scope.destroyed,
		requestDelta:
			topic13CallsAfterCategoryClear - topic13CallsBeforeCategoryClear,
	})}`,
);
(settingsView as ReaderSettingsView<TestPreferences>).close();
const finalQuoteTarget = await activeRuntime.openTarget({
	topicId: 11,
	postNumber: 1,
	source: 'quote',
	alignment: 'nearest',
	highlight: false,
	quoteHighlight: Object.freeze({
		postNumber: discoursePostNumber(1),
		text: 'next-content',
		active: true,
		source: Object.freeze({
			topicId: discourseTopicId(10),
			postNumber: discoursePostNumber(3),
			parentPostNumber: discoursePostNumber(1),
			nested: false,
			anchor: Object.freeze({
				viewport: physicalHistoryAnchor.viewport,
				replyWindow: capturedDiscussionState,
				quoteHighlight: null,
			}),
		}),
	}),
});
const finalQuoteReturn = shellRoot.querySelector<HTMLButtonElement>(
	'.ldp-quote-highlight-return',
);
assert(
	(finalQuoteTarget.topic.status === 'opened' ||
		finalQuoteTarget.topic.status === 'reused') &&
	finalQuoteTarget.navigation?.status === 'revealed' &&
	finalQuoteReturn?.textContent === '返回引用楼层',
	'最终运行时的跨 Topic 引用必须挂载可操作的返回入口',
);
finalQuoteReturn.click();
for (let turn = 0; turn < 2_000; turn += 1) {
	if (
		activeRuntime.shell.activeTopicId === 10 &&
		activeRuntime.shell.activeValue?.topicContext.snapshot().discussion
			?.rootPostNumber === 2
	) break;
	await new Promise((resolve) => setTimeout(resolve, 1));
}
const returnedQuoteAnchor = activeRuntime.shell.activeValue
	?.dom.captureViewportAnchor();
assert(
	activeRuntime.shell.activeTopicId === 10 &&
	activeRuntime.shell.activeValue?.topicContext.snapshot().discussion
		?.rootPostNumber === 2 &&
	returnedQuoteAnchor?.postNumber === physicalHistoryAnchor.viewport.postNumber &&
	returnedQuoteAnchor.postOffset === physicalHistoryAnchor.viewport.postOffset,
	`跨 Topic 返回引用处必须恢复来源讨论浮窗与原可见视野锚点，不得只跳到楼层顶部：${JSON.stringify({
		topicId: activeRuntime.shell.activeTopicId,
		discussionRoot:
			activeRuntime.shell.activeValue?.topicContext.snapshot().discussion
				?.rootPostNumber,
		returnedQuoteAnchor,
		expectedViewport: physicalHistoryAnchor.viewport,
	})}`,
);
const semanticSourceTarget = await activeRuntime.openTarget({
	topicId: 11,
	postNumber: 1,
	source: 'quote',
	alignment: 'nearest',
	highlight: false,
	quoteHighlight: Object.freeze({
		postNumber: discoursePostNumber(1),
		text: 'next-content',
		active: true,
		source: Object.freeze({
			topicId: discourseTopicId(10),
			postNumber: discoursePostNumber(1),
			parentPostNumber: null,
			nested: false,
			anchor: Object.freeze({
				viewport: Object.freeze({
					postNumber: discoursePostNumber(2),
					postOffset: 0,
					scrollTop: 0,
				}),
				replyWindow: null,
				quoteHighlight: null,
			}),
		}),
	}),
});
const semanticSourceReturn = shellRoot.querySelector<HTMLButtonElement>(
	'.ldp-quote-highlight-return',
);
assert(
	semanticSourceTarget.navigation?.status === 'revealed' &&
		semanticSourceReturn !== null,
	'语义来源与物理锚点分离回归必须先建立可返回的跨 Topic 引用',
);
semanticSourceReturn.click();
for (let turn = 0; turn < 2_000; turn += 1) {
	if (
		activeRuntime.shell.activeTopicId === 10 &&
		activeRuntime.shell.activeValue?.topicContext.snapshot().discussion === null
	) break;
	await new Promise((resolve) => setTimeout(resolve, 1));
}
const semanticSourceRoot = shellRoot.querySelector<HTMLElement>(
	'[data-post-number="1"]',
);
const physicalAnchorRoot = shellRoot.querySelector<HTMLElement>(
	'[data-post-number="2"]',
);
assert(
	activeRuntime.shell.activeValue?.topicTimeline.snapshot.currentPostNumber === 2 &&
		semanticSourceRoot?.classList.contains('ldp-jump-highlight') &&
		!physicalAnchorRoot?.classList.contains('ldp-jump-highlight'),
	'引用从 #1 跳出后返回时，必须静默恢复 #2 的物理视野并只闪烁语义来源 #1',
);
await activeRuntime.close();
application.destroy();
let settingsAfterDestroyRejected = false;
try {
	(settingsController as ReaderSettingsController<TestPreferences>).registerDraft({
		panelId: 'font',
		changeCount: () => 0,
		validate: () => [],
		createPatch: () => ({}),
		acceptPersisted() {},
		discard() {},
	});
} catch {
	settingsAfterDestroyRejected = true;
}
assert(
	activeRuntime.scope.destroyed &&
		(settingsView as ReaderSettingsView<TestPreferences>).scope.destroyed &&
		(layoutStyle as ReaderLayoutStyleController<TestPreferences>).scope
			.destroyed &&
		Number(appEventSubscriptions.size) === 0 &&
		nativeAjaxObservationState() === '0/2/2' &&
		readyCleanups === 1 &&
		!document.querySelector('.ldp-overlay') &&
		!document.querySelector('.ldp-settings-toggle') &&
		!document.querySelector('.ldp-settings-popover') &&
		settingsAfterDestroyRejected,
	'Application destroy 必须反向释放运行时、Workspace、Settings controller/View 与 Shell DOM',
);
const rejected = await activeRuntime.open(10);
assert(rejected.status === 'failed', '运行时销毁后不得复用 Shell 的旧 Topic');
