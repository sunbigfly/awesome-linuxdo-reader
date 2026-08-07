import type {
	BrowserCreditBridgeHttpPort,
	BrowserUserscriptValueStoragePort,
} from '../userscript/browser-userscript-environment.js';
import { objectRecord } from '../kernel/value-record.js';

export const READER_CREDIT_BRIDGE_CACHE_KEY =
	'awesome-linuxdo-reader:ldc-user-bridge:v1';

type CreditBridgeTimer = Pick<Window, 'setTimeout'> & Partial<Pick<
	Window,
	'clearTimeout' | 'addEventListener' | 'removeEventListener'
>>;

/**
 * credit.linux.do 上唯一的同源桥。
 *
 * 此分支不启动 Discourse Reader，只在页面 load 后读取原站只读 user-info，并继续写旧版
 * GM key，供升级/回滚共享最近一次成功结果。失败保留旧值。
 */
export function scheduleReaderCreditAccountBridge(
	timer: CreditBridgeTimer,
	document: Document,
	storage: BrowserUserscriptValueStoragePort | null,
	http: BrowserCreditBridgeHttpPort,
	onError: (cause: unknown) => void = () => {},
): () => void {
	if (!storage) return () => {};
	const controller = new AbortController();
	let startTimer: number | null = null;
	let timeoutTimer: number | null = null;
	let started = false;
	const clear = (timerId: number | null): void => {
		if (timerId !== null) timer.clearTimeout?.(timerId);
	};
	const onPageHide = (): void => {
		clear(startTimer);
		clear(timeoutTimer);
		startTimer = null;
		timeoutTimer = null;
		document.defaultView?.removeEventListener('load', sync);
		controller.abort(new DOMException('LDC 页面已退出', 'AbortError'));
	};
	timer.addEventListener?.('pagehide', onPageHide, { once: true });
	const sync = (): void => {
		if (started) return;
		started = true;
		startTimer = timer.setTimeout(() => {
			startTimer = null;
			timeoutTimer = timer.setTimeout(() => {
				controller.abort(new DOMException('LDC bridge 请求超时', 'TimeoutError'));
			}, 10_000);
			void http.loadUserInfo(controller.signal).then(async (result) => {
				const data = objectRecord(objectRecord(result)?.data);
				const username = typeof data?.username === 'string'
					? data.username.trim()
					: '';
				if (data && username) {
					await storage.setValue(READER_CREDIT_BRIDGE_CACHE_KEY, {
						data,
						cachedAt: Date.now(),
					});
				}
			}).catch((cause) => {
				const reason = controller.signal.reason;
				if (
					!controller.signal.aborted ||
					(reason instanceof DOMException && reason.name === 'TimeoutError')
				) {
					onError(cause);
				}
			}).finally(() => {
				clear(timeoutTimer);
				timeoutTimer = null;
			});
		}, 1_000);
	};
	if (document.readyState === 'complete') sync();
	else document.defaultView?.addEventListener('load', sync, { once: true });
	return () => {
		clear(startTimer);
		clear(timeoutTimer);
		document.defaultView?.removeEventListener('load', sync);
		timer.removeEventListener?.('pagehide', onPageHide);
		controller.abort(new DOMException('LDC bridge 已销毁', 'AbortError'));
	};
}
