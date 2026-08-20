import {
	BrowserDiscourseHostApiPort,
	discourseNativeCurrentUserBindingAvailable,
} from '../discourse/native-host-api.js';
import { abortableDelay } from '../network/coordinated-request-client.js';
import {
	discourseNativeAjaxAvailable,
} from '../network/discourse-native-read-transport.js';
import {
	BrowserPublicResourceHttpPort,
	type BrowserPublicResourceRequestPort,
} from '../network/public-resource-request-adapter.js';
import type {
	ObjectUrlPort,
} from '../media/reader-image-resource-service.js';
import type {
	BrowserAssetCacheStoragePort,
} from '../cache/browser-asset-cache.js';
import {
	normalizeReaderSearchText,
	type ReaderSearchFormsPort,
} from '../search/reader-search.js';
import {
	BrowserUserscriptExternalHttpPort,
	type BrowserUserscriptExternalHttpPortOptions,
	type UserscriptExternalRequestOptions,
	type UserscriptExternalRequestPort,
} from '../translation/translation-request-adapter.js';
import {
	BrowserReaderShareSurface,
} from './browser-share-surface.js';
import type {
	ReaderHlsPort,
	ReaderHlsPlayerPort,
} from '../media/reader-media-controller.js';
import type {
	ReaderKatexPort,
	ReaderKatexRenderOptions,
} from '../media/reader-katex-controller.js';
import {
	BrowserDiscourseSiteProbe,
	type BrowserDiscourseSiteProbeRequestOptions,
	type BrowserDiscourseSiteProbeRequestPort,
} from '../site/browser-discourse-site-probe.js';
import {
	objectRecord,
	type UnknownRecord,
} from '../kernel/value-record.js';
import {
	ReaderWebDavClient,
	type ReaderWebDavRequestOptions,
	type ReaderWebDavRequestPort,
} from '../sync/reader-webdav-client.js';
type HlsConstructor = {
	new (): UnknownRecord;
	readonly isSupported?: unknown;
};

export interface BrowserUserscriptEnvironmentOptions {
	readonly userscriptGlobal: unknown;
}

export type BrowserUserscriptSearchFormsPort = ReaderSearchFormsPort;

export interface BrowserUserscriptValueStoragePort {
	getValue(key: string): unknown | Promise<unknown>;
	setValue(key: string, value: unknown): void | Promise<void>;
	subscribe?(
		key: string,
		listener: (value: unknown, previous: unknown) => void,
	): () => void;
}

export interface BrowserCreditBridgeHttpPort {
	loadUserInfo(signal: AbortSignal): Promise<unknown>;
}

export interface BrowserUserscriptRuntimeReadinessOptions {
	readonly timeoutMs?: number;
	readonly pollIntervalMs?: number;
	readonly now?: () => number;
	readonly delay?: (
		milliseconds: number,
		signal: AbortSignal,
	) => Promise<void>;
}

function runtimeReadinessTimeout(pageWindow: unknown): number {
	const page = objectRecord(pageWindow);
	const navigatorValue = objectRecord(page?.navigator);
	const connection = objectRecord(navigatorValue?.connection);
	const documentValue = objectRecord(page?.document);
	const cores = Number(navigatorValue?.hardwareConcurrency);
	const memory = Number(navigatorValue?.deviceMemory);
	const effectiveType = String(connection?.effectiveType ?? '')
		.trim()
		.toLowerCase();
	if (String(documentValue?.visibilityState ?? '') === 'hidden') return 60_000;
	const constrained =
		(Number.isFinite(cores) && cores > 0 && cores <= 4) ||
		(Number.isFinite(memory) && memory > 0 && memory <= 4) ||
		connection?.saveData === true ||
		['slow-2g', '2g', '3g'].includes(effectiveType);
	return constrained ? 45_000 : 25_000;
}

/**
 * Greasemonkey/Tampermonkey 全局能力的唯一适配器。
 *
 * `unsafeWindow` 只用于构造只读 Discourse 宿主桥；`GM_xmlhttpRequest` 只交给带固定
 * endpoint allowlist 的外部端口。站内 Discourse API 永远不经过 GM 请求；LDC 页面
 * 唯一的同源只读桥也在这里窄化 page fetch，业务层不能直接取得 transport。
 */
export class BrowserUserscriptEnvironment {
	readonly #userscriptGlobal: UnknownRecord;
	readonly pageWindow: unknown;
	readonly discourseHost: BrowserDiscourseHostApiPort;

	constructor(options: BrowserUserscriptEnvironmentOptions) {
		const userscriptGlobal = objectRecord(options.userscriptGlobal);
		if (!userscriptGlobal) throw new Error('userscript global 不可用');
		const pageWindow = userscriptGlobal.unsafeWindow ?? userscriptGlobal.window;
		if (!objectRecord(pageWindow)) {
			throw new Error('userscript page window 不可用');
		}
		this.#userscriptGlobal = userscriptGlobal;
		this.pageWindow = pageWindow;
		this.discourseHost = new BrowserDiscourseHostApiPort({ pageWindow });
	}

	async waitForDiscourseRuntime(
		signal: AbortSignal,
		options: BrowserUserscriptRuntimeReadinessOptions = {},
	): Promise<void> {
		const timeoutMs = Math.max(
			1,
			Math.floor(
				options.timeoutMs ?? runtimeReadinessTimeout(this.pageWindow),
			),
		);
		const pollIntervalMs = Math.max(
			1,
			Math.floor(options.pollIntervalMs ?? 50),
		);
		const now = options.now ?? Date.now;
		const delay = options.delay ?? abortableDelay;
		const startedAt = now();
		while (
			!discourseNativeAjaxAvailable(this.discourseHost) ||
			!discourseNativeCurrentUserBindingAvailable(this.discourseHost)
		) {
			if (signal.aborted) throw signal.reason;
			const remaining = timeoutMs - (now() - startedAt);
			if (remaining <= 0) {
				throw new Error(
					'Discourse 原生 Ajax/current-user 在启动期限内未就绪',
				);
			}
			await delay(Math.min(pollIntervalMs, remaining), signal);
		}
	}

	createExternalHttp(
		options: Omit<BrowserUserscriptExternalHttpPortOptions, 'request'> = {},
	): BrowserUserscriptExternalHttpPort {
		const rawRequest = this.#userscriptGlobal.GM_xmlhttpRequest;
		if (typeof rawRequest !== 'function') {
			throw new Error('GM_xmlhttpRequest 不可用，无法访问登记的外部服务');
		}
		const request: UserscriptExternalRequestPort = (
			requestOptions: UserscriptExternalRequestOptions,
		) => rawRequest.call(this.#userscriptGlobal, requestOptions);
		return new BrowserUserscriptExternalHttpPort({
			...options,
			request,
		});
	}

	createDiscourseSiteProbe(): BrowserDiscourseSiteProbe {
		const rawRequest = this.#userscriptGlobal.GM_xmlhttpRequest;
		if (typeof rawRequest !== 'function') {
			throw new Error('GM_xmlhttpRequest 不可用，无法检测自定义站点');
		}
		const request: BrowserDiscourseSiteProbeRequestPort = (
			requestOptions: BrowserDiscourseSiteProbeRequestOptions,
		) => rawRequest.call(this.#userscriptGlobal, requestOptions);
		return new BrowserDiscourseSiteProbe({ request });
	}

	createWebDavClient(): ReaderWebDavClient {
		const rawRequest = this.#userscriptGlobal.GM_xmlhttpRequest;
		if (typeof rawRequest !== 'function') {
			throw new Error('GM_xmlhttpRequest 不可用，无法访问 WebDAV');
		}
		const request: ReaderWebDavRequestPort = (
			requestOptions: ReaderWebDavRequestOptions,
		) => rawRequest.call(this.#userscriptGlobal, requestOptions);
		return new ReaderWebDavClient({ request });
	}

	createPublicResourceHttp(): BrowserPublicResourceHttpPort {
		const page = objectRecord(this.pageWindow);
		const rawRequest = page?.fetch;
		if (typeof rawRequest !== 'function') {
			throw new Error('page window fetch 不可用，无法访问公共图片资源');
		}
		const request: BrowserPublicResourceRequestPort = (input, init) =>
			rawRequest.call(this.pageWindow, input, init) as ReturnType<
				BrowserPublicResourceRequestPort
			>;
		return new BrowserPublicResourceHttpPort({ request });
	}

	createExternalStylesheetAppender(): (href: string) => HTMLLinkElement {
		const rawAddElement = this.#userscriptGlobal.GM_addElement;
		if (typeof rawAddElement === 'function') {
			return (href) => rawAddElement.call(
				this.#userscriptGlobal,
				'link',
				Object.freeze({ rel: 'stylesheet', href }),
			) as HTMLLinkElement;
		}
		const page = objectRecord(this.pageWindow);
		const document = page?.document as Document | undefined;
		if (!document?.createElement) {
			throw new Error('页面无法创建外部字体样式');
		}
		return (href) => {
			const link = document.createElement('link');
			link.rel = 'stylesheet';
			link.href = href;
			(document.head ?? document.documentElement).append(link);
			return link;
		};
	}

	createCreditBridgeHttp(): BrowserCreditBridgeHttpPort {
		const page = objectRecord(this.pageWindow);
		const rawRequest = page?.fetch;
		if (typeof rawRequest !== 'function') {
			throw new Error('page window fetch 不可用，无法读取 LDC 账户摘要');
		}
		return Object.freeze({
			loadUserInfo: async (signal: AbortSignal) => {
				const response = await rawRequest.call(
					this.pageWindow,
					'/api/v1/oauth/user-info',
					{
						signal,
						credentials: 'include',
						cache: 'no-store',
						headers: { Accept: 'application/json' },
					},
				) as Response;
				if (!response.ok) throw new Error(`LDC HTTP ${response.status}`);
				return response.json();
			},
		});
	}

	createObjectUrlPort(): ObjectUrlPort {
		const page = objectRecord(this.pageWindow);
		const urlOwner = page?.URL as
			| Readonly<{
				createObjectURL?: unknown;
				revokeObjectURL?: unknown;
			}>
			| undefined;
		const create = urlOwner?.createObjectURL;
		const revoke = urlOwner?.revokeObjectURL;
		if (typeof create !== 'function' || typeof revoke !== 'function') {
			throw new Error('page window URL.createObjectURL/revokeObjectURL 不可用');
		}
		return Object.freeze({
			createObjectURL: (blob: Blob) => String(create.call(urlOwner, blob)),
			revokeObjectURL: (source: string) => {
				revoke.call(urlOwner, source);
			},
		});
	}

	createAssetCacheStorage(): BrowserAssetCacheStoragePort | null {
		const page = objectRecord(this.pageWindow);
		const storage = objectRecord(page?.caches);
		const keys = storage?.keys;
		const open = storage?.open;
		const remove = storage?.delete;
		if (
			typeof keys !== 'function' ||
			typeof open !== 'function' ||
			typeof remove !== 'function'
		) {
			return null;
		}
		return Object.freeze({
			keys: () => keys.call(storage) as Promise<readonly string[]>,
			open: (name: string) =>
				open.call(storage, name) as ReturnType<
					BrowserAssetCacheStoragePort['open']
				>,
			delete: (name: string) =>
				remove.call(storage, name) as Promise<boolean>,
		});
	}

	createValueStorage(): BrowserUserscriptValueStoragePort | null {
		const subscription = (
			owner: UnknownRecord,
			add: (...args: unknown[]) => unknown,
			remove: (...args: unknown[]) => unknown,
		) => (
			key: string,
			listener: (value: unknown, previous: unknown) => void,
		): (() => void) => {
			let active = true;
			let id: Promise<unknown>;
			try {
				id = Promise.resolve(add.call(
					owner,
					String(key),
					(
						_name: unknown,
						previous: unknown,
						value: unknown,
						remote: unknown,
					) => {
						if (active && remote === true) listener(value, previous);
					},
				));
			} catch {
				return () => {};
			}
			return () => {
				if (!active) return;
				active = false;
				void id.then((listenerId) =>
					remove.call(owner, listenerId)).catch(() => {});
			};
		};
		const modern = objectRecord(this.#userscriptGlobal.GM);
		const modernGet = modern?.getValue;
		const modernSet = modern?.setValue;
		const modernAdd = modern?.addValueChangeListener;
		const modernRemove = modern?.removeValueChangeListener;
		if (
			modern &&
			typeof modernGet === 'function' &&
			typeof modernSet === 'function'
		) {
			return Object.freeze({
				getValue: (key: string) => modernGet.call(modern, key, null),
				setValue: (key: string, value: unknown) =>
					modernSet.call(modern, key, value) as void | Promise<void>,
				...(typeof modernAdd === 'function' &&
					typeof modernRemove === 'function'
					? {
						subscribe: subscription(
							modern,
							modernAdd as (...args: unknown[]) => unknown,
							modernRemove as (...args: unknown[]) => unknown,
						),
					}
					: {}),
			});
		}
		const legacyGet = this.#userscriptGlobal.GM_getValue;
		const legacySet = this.#userscriptGlobal.GM_setValue;
		const legacyAdd = this.#userscriptGlobal.GM_addValueChangeListener;
		const legacyRemove = this.#userscriptGlobal.GM_removeValueChangeListener;
		if (
			typeof legacyGet !== 'function' ||
			typeof legacySet !== 'function'
		) {
			return null;
		}
		return Object.freeze({
			getValue: (key: string) =>
				legacyGet.call(this.#userscriptGlobal, key, null),
			setValue: (key: string, value: unknown) =>
				legacySet.call(this.#userscriptGlobal, key, value) as
					| void
					| Promise<void>,
			...(typeof legacyAdd === 'function' &&
				typeof legacyRemove === 'function'
				? {
					subscribe: subscription(
						this.#userscriptGlobal,
						legacyAdd as (...args: unknown[]) => unknown,
						legacyRemove as (...args: unknown[]) => unknown,
					),
				}
				: {}),
		});
	}

	createShareSurface(): BrowserReaderShareSurface {
		return new BrowserReaderShareSurface(this.pageWindow);
	}

	createKatexPort(): ReaderKatexPort | null {
		const page = objectRecord(this.pageWindow);
		const owner =
			objectRecord(this.#userscriptGlobal.katex) ??
			objectRecord(page?.katex);
		const render = owner?.render;
		if (typeof render !== 'function') return null;
		return Object.freeze({
			render: (
				tex: string,
				target: HTMLElement,
				options: ReaderKatexRenderOptions,
			) => {
				render.call(owner, tex, target, options);
			},
		});
	}

	createHlsPort(): ReaderHlsPort | null {
		const page = objectRecord(this.pageWindow);
		const candidate = (
			this.#userscriptGlobal.Hls ??
			page?.Hls
		) as HlsConstructor | undefined;
		const isSupported = candidate?.isSupported;
		if (
			typeof candidate !== 'function' ||
			typeof isSupported !== 'function'
		) {
			return null;
		}
		return Object.freeze({
			isSupported: () =>
				Boolean(isSupported.call(candidate)),
			create: (): ReaderHlsPlayerPort => {
				const player = new candidate();
				const loadSource = player.loadSource;
				const attachMedia = player.attachMedia;
				const destroy = player.destroy;
				if (
					typeof loadSource !== 'function' ||
					typeof attachMedia !== 'function' ||
					typeof destroy !== 'function'
				) {
					throw new Error('Hls player 缺少标准生命周期方法');
				}
				return Object.freeze({
					loadSource: (source: string) => {
						loadSource.call(player, source);
					},
					attachMedia: (video: HTMLVideoElement) => {
						attachMedia.call(player, video);
					},
					destroy: () => {
						destroy.call(player);
					},
				});
			},
		});
	}

	readScriptVersion(): string | null {
		const modern = objectRecord(this.#userscriptGlobal.GM);
		const info =
			objectRecord(modern?.info) ??
			objectRecord(this.#userscriptGlobal.GM_info);
		const script = objectRecord(info?.script);
		const version = String(script?.version ?? '').trim();
		return version || null;
	}

	async readTextResource(name: string): Promise<string> {
		const resourceName = String(name).trim();
		if (!resourceName) throw new Error('userscript resource name 不能为空');
		const modern = objectRecord(this.#userscriptGlobal.GM);
		const modernRead = modern?.getResourceText;
		const legacyRead = this.#userscriptGlobal.GM_getResourceText;
		const value = typeof modernRead === 'function'
			? await modernRead.call(modern, resourceName)
			: typeof legacyRead === 'function'
				? await legacyRead.call(this.#userscriptGlobal, resourceName)
				: null;
		if (typeof value !== 'string' || !value.trim()) {
			throw new Error(
				`userscript 文本资源 ${resourceName} 不可用`,
			);
		}
		return value;
	}

	createPinyinSearchForms(
		maxEntries = 512,
	): BrowserUserscriptSearchFormsPort {
		const limit = Math.floor(Number(maxEntries));
		if (!Number.isSafeInteger(limit) || limit <= 0) {
			throw new RangeError('拼音搜索缓存上限必须是正整数');
		}
		const page = objectRecord(this.pageWindow);
		const pinyinOwner =
			objectRecord(this.#userscriptGlobal.pinyinPro) ??
			objectRecord(page?.pinyinPro);
		const pinyin = pinyinOwner?.pinyin;
		const cache = new Map<string, readonly string[]>();
		return (value) => {
			const source = String(value ?? '');
			if (!source) return Object.freeze([]);
			const cached = cache.get(source);
			if (cached) {
				cache.delete(source);
				cache.set(source, cached);
				return cached;
			}
			const forms = [normalizeReaderSearchText(source)];
			if (typeof pinyin === 'function') {
				try {
					forms.push(normalizeReaderSearchText(pinyin.call(pinyinOwner, source, {
						toneType: 'none',
						nonZh: 'consecutive',
					})));
					forms.push(normalizeReaderSearchText(pinyin.call(pinyinOwner, source, {
						pattern: 'first',
						toneType: 'none',
						nonZh: 'consecutive',
					})));
				} catch {
					// @require 尚未就绪或单次转写失败时保留标题原文搜索。
				}
			}
			const result = Object.freeze([...new Set(forms.filter(Boolean))]);
			cache.set(source, result);
			while (cache.size > limit) {
				const oldest = cache.keys().next().value;
				if (oldest === undefined) break;
				cache.delete(oldest);
			}
			return result;
		};
	}
}
