import type { LifecycleScope } from '../kernel/lifecycle.js';
import type {
	RequestObserver,
	RequestObservationFinish,
} from './request-observer.js';
import type {
	BrowserSharedHostRequestBudgetPort,
	BrowserSharedHostRequestLease,
} from './browser-shared-request-permit.js';

interface JQueryAjaxSettings {
	readonly url?: unknown;
	readonly type?: unknown;
	readonly method?: unknown;
}

interface JQueryAjaxResponse {
	readonly status?: unknown;
	readonly responseURL?: unknown;
	getResponseHeader?(name: string): string | null;
}

interface JQueryEventTarget {
	on(name: string, handler: (...args: readonly unknown[]) => void): void;
	off(name: string, handler: (...args: readonly unknown[]) => void): void;
}

type JQueryModule = (target: Document) => JQueryEventTarget;

export interface DiscourseNativeAjaxObservationAdapterOptions {
	readonly observer: RequestObserver;
	readonly jqueryModule: unknown;
	readonly document?: Document;
	readonly namespace?: string;
	readonly hostRequestBudget?: BrowserSharedHostRequestBudgetPort;
}

export interface BrowserResourceObservationAdapterOptions {
	readonly observer: RequestObserver;
	readonly performance?: Pick<Performance, 'timeOrigin'>;
	readonly createObserver?: (
		callback: PerformanceObserverCallback,
	) => Pick<PerformanceObserver, 'observe' | 'disconnect'>;
}

function jqueryModule(value: unknown): JQueryModule | null {
	const candidate = value && typeof value === 'object' && 'default' in value
		? (value as { readonly default?: unknown }).default
		: value;
	return typeof candidate === 'function' ? candidate as JQueryModule : null;
}

function ajaxResponseHeader(response: JQueryAjaxResponse, name: string): string {
	try {
		return String(response.getResponseHeader?.(name) ?? '');
	} catch {
		return '';
	}
}

function ajaxFinish(response: JQueryAjaxResponse): RequestObservationFinish {
	const status = Number(response.status);
	return Object.freeze({
		...(Number.isFinite(status) && status >= 0 ? { status } : {}),
		rateLimitCode:
			ajaxResponseHeader(response, 'Discourse-Rate-Limit-Error-Code') ||
			ajaxResponseHeader(response, 'X-Discourse-Rate-Limit-Error-Code'),
		retryAfter: ajaxResponseHeader(response, 'Retry-After'),
		serverLimit:
			ajaxResponseHeader(response, 'RateLimit-Limit') ||
			ajaxResponseHeader(response, 'X-RateLimit-Limit'),
		serverRemaining:
			ajaxResponseHeader(response, 'RateLimit-Remaining') ||
			ajaxResponseHeader(response, 'X-RateLimit-Remaining'),
		serverReset:
			ajaxResponseHeader(response, 'RateLimit-Reset') ||
			ajaxResponseHeader(response, 'X-RateLimit-Reset'),
	});
}

/**
 * 通过 Discourse 自带 jQuery ajax lifecycle 被动观测宿主请求。
 * 不 monkey-patch fetch/XMLHttpRequest，也不发送或改写任何请求。
 */
export class DiscourseNativeAjaxObservationAdapter {
	readonly #observer: RequestObserver;
	readonly #jqueryModule: unknown;
	readonly #document: Document;
	readonly #namespace: string;
	readonly #hostRequestBudget: BrowserSharedHostRequestBudgetPort | null;

	constructor(options: DiscourseNativeAjaxObservationAdapterOptions) {
		this.#observer = options.observer;
		this.#jqueryModule = options.jqueryModule;
		this.#document = options.document ?? document;
		this.#hostRequestBudget = options.hostRequestBudget ?? null;
		const namespace = String(options.namespace ?? 'mianLiteRequestObserver').trim();
		if (!/^[A-Za-z][A-Za-z0-9]*$/.test(namespace)) {
			throw new Error('jQuery ajax observation namespace 非法');
		}
		this.#namespace = namespace;
	}

	install(scope: LifecycleScope): boolean {
		let module: JQueryModule | null = null;
		try {
			module = jqueryModule(this.#jqueryModule);
		} catch {
			return false;
		}
		if (!module) return false;
		let target: JQueryEventTarget;
		try {
			target = module(this.#document);
		} catch {
			return false;
		}
		if (!target || typeof target.on !== 'function' || typeof target.off !== 'function') {
			return false;
		}
		const active = new Map<object, {
			readonly id: number;
			readonly borrowed: boolean;
			readonly hostLease: BrowserSharedHostRequestLease | null;
			readonly sharedResponse: Readonly<{
				readonly source: 'host' | 'reader';
				readonly recoveryProbe: boolean;
			}> | null;
		}>();
		const borrowedIds = new Set<number>();
		const send = (
			_event: unknown,
			rawResponse: unknown,
			rawSettings: unknown,
		): void => {
			if (!rawResponse || typeof rawResponse !== 'object') return;
			const settings = (rawSettings ?? {}) as JQueryAjaxSettings;
			const href = String(settings.url ?? '');
			if (!href) return;
			const method = String(settings.type ?? settings.method ?? 'GET');
			const readerId = this.#observer.matchActive({
				href,
				method,
				source: 'reader',
				excludedIds: borrowedIds,
			});
			if (readerId !== null) borrowedIds.add(readerId);
			const id = readerId ?? this.#observer.begin({
					href,
					method,
					transport: 'xmlhttprequest',
					source: 'host',
				});
			const event = this.#observer.snapshot.events.find(
				(candidate) => candidate.id === id,
			);
			/*
			 * MessageBus/Presence 是服务器入站事件承载：无限接收、只观测，
			 * 不占 Reader 主动 REST 的窗口或并发 lease。
			 */
			const sharedApiResponse = Boolean(
				event?.sameOrigin &&
					!['avatar', 'media', 'asset', 'realtime', 'presence'].includes(
						event.type,
					),
			);
			const countsAgainstSharedBudget = sharedApiResponse &&
				event?.source === 'host' &&
				event.transport === 'xmlhttprequest';
			let hostLease: BrowserSharedHostRequestLease | null = null;
			if (countsAgainstSharedBudget && this.#hostRequestBudget && event) {
				try {
					hostLease = this.#hostRequestBudget.recordHostStart({
						startedAt: event.startedAt,
					});
				} catch {
					// 被动记账失败不能阻断或改写宿主原生请求。
				}
			}
			active.set(rawResponse, {
				id,
				borrowed: readerId !== null,
				hostLease,
				sharedResponse: sharedApiResponse && event
					? Object.freeze({
						source: event.source === 'reader' ? 'reader' : 'host',
						recoveryProbe: event.recoveryProbe,
					})
					: null,
			});
		};
		const complete = (
			_event: unknown,
			rawResponse: unknown,
		): void => {
			if (!rawResponse || typeof rawResponse !== 'object') return;
			const current = active.get(rawResponse);
			if (!current) return;
			active.delete(rawResponse);
			if (current.borrowed) borrowedIds.delete(current.id);
			current.hostLease?.release();
			const finish = ajaxFinish(rawResponse as JQueryAjaxResponse);
			this.#observer.finish(
				current.id,
				finish,
			);
			if (current.sharedResponse && this.#hostRequestBudget) {
				try {
					this.#hostRequestBudget.noteObservedResponse({
						...current.sharedResponse,
						status: finish.status ?? 0,
						retryAfter: finish.retryAfter ?? '',
						rateLimitCode: finish.rateLimitCode ?? '',
						serverLimit: finish.serverLimit ?? '',
						serverRemaining: finish.serverRemaining ?? '',
						serverReset: finish.serverReset ?? '',
					});
				} catch {
					// 响应学习失败不能改变宿主或 Reader 已完成请求的结果。
				}
			}
		};
		const sendEvent = `ajaxSend.${this.#namespace}`;
		const completeEvent = `ajaxComplete.${this.#namespace}`;
		try {
			target.on(sendEvent, send);
			target.on(completeEvent, complete);
		} catch {
			try {
				target.off(sendEvent, send);
				target.off(completeEvent, complete);
			} catch {
				// 局部绑定失败时只能尽力撤销，不能让观测器阻断 Reader 启动。
			}
			return false;
		}
		scope.add(() => {
			target.off(sendEvent, send);
			target.off(completeEvent, complete);
			for (const current of active.values()) {
				current.hostLease?.release();
				if (!current.borrowed) {
					this.#observer.finish(current.id, {
						error: 'observer-detached',
					});
				}
			}
			active.clear();
			borrowedIds.clear();
		});
		return true;
	}
}

/**
 * 浏览器资源时序 adapter。fetch/xhr 条目只补充已有观测，不制造第二条重复请求。
 */
export class BrowserResourceObservationAdapter {
	readonly #observer: RequestObserver;
	readonly #performance: Pick<Performance, 'timeOrigin'>;
	readonly #createObserver: NonNullable<
		BrowserResourceObservationAdapterOptions['createObserver']
	>;

	constructor(options: BrowserResourceObservationAdapterOptions) {
		this.#observer = options.observer;
		this.#performance = options.performance ?? performance;
		this.#createObserver = options.createObserver ??
			((callback) => new PerformanceObserver(callback));
	}

	install(scope: LifecycleScope): boolean {
		let nativeObserver: Pick<PerformanceObserver, 'observe' | 'disconnect'> | null = null;
		try {
			nativeObserver = this.#createObserver((list) => {
				for (const entry of list.getEntries()) {
					if (entry.entryType !== 'resource') continue;
					const resource = entry as PerformanceResourceTiming;
					this.#observer.recordResource({
						href: resource.name,
						initiatorType: resource.initiatorType,
						startedAt: this.#performance.timeOrigin + resource.startTime,
						endedAt: this.#performance.timeOrigin +
							(resource.responseEnd || resource.startTime + resource.duration),
						status: Number(resource.responseStatus) || 0,
						size: Number(resource.transferSize || resource.encodedBodySize) || 0,
					});
				}
			});
			nativeObserver.observe({ type: 'resource', buffered: true });
		} catch {
			nativeObserver?.disconnect();
			return false;
		}
		const installedObserver = nativeObserver;
		scope.add(() => installedObserver.disconnect());
		return true;
	}
}
