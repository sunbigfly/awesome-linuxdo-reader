export const READER_NATIVE_BYPASS_PARAMETER = 'ldp_native';
export const READER_NATIVE_BYPASS_TAB_KEY =
	'linuxdo-enhanced-reader:native-tab';

interface ReaderNativeTabWindow {
	readonly sessionStorage: Pick<Storage, 'setItem'>;
	opener: unknown;
	readonly location: Readonly<{
		replace(value: string): void;
	}> & { href: string };
}

interface ReaderNativeSourceWindow {
	readonly sessionStorage: Pick<Storage, 'getItem' | 'removeItem'>;
	open(value: string, target: string): ReaderNativeTabWindow | null;
}

function httpUrl(value: string, baseValue: string): URL | null {
	try {
		const base = new URL(baseValue);
		const url = new URL(value, base);
		return /^https?:$/i.test(url.protocol) &&
			url.origin === base.origin
			? url
			: null;
	} catch {
		return null;
	}
}

export function readerNativeTopicHref(
	value: string,
	baseValue: string,
): string {
	const url = httpUrl(value, baseValue);
	if (!url) return '';
	url.searchParams.set(READER_NATIVE_BYPASS_PARAMETER, '1');
	return url.href;
}

export function readerNativeBypassCleanHref(
	value: string,
	baseValue: string,
): string | null {
	const url = httpUrl(value, baseValue);
	if (!url?.searchParams.has(READER_NATIVE_BYPASS_PARAMETER)) {
		return null;
	}
	url.searchParams.delete(READER_NATIVE_BYPASS_PARAMETER);
	return url.href;
}

/**
 * userscript 启动前消费一次原生页面绕过信号。
 *
 * replace 由浏览器入口注入，本函数只拥有 URL 协议；成功返回 true 后调用方必须停止创建
 * application、Shell、请求和事件订阅。
 */
export function consumeReaderNativeBypass(
	value: string,
	baseValue: string,
	replace: (cleanHref: string) => void,
): boolean {
	const cleanHref = readerNativeBypassCleanHref(value, baseValue);
	if (!cleanHref) return false;
	replace(cleanHref);
	return true;
}

/**
 * URL 参数可能在 userscript 真正执行前被 Discourse canonical route 清掉，因此新标签再带
 * 一个只消费一次的 sessionStorage 信号；它只作用于刚创建的目标标签。
 */
export function consumeReaderNativeTabBypass(
	window: Pick<ReaderNativeSourceWindow, 'sessionStorage'>,
): boolean {
	try {
		const bypass = window.sessionStorage.getItem(
			READER_NATIVE_BYPASS_TAB_KEY,
		) === '1';
		if (bypass) {
			window.sessionStorage.removeItem(READER_NATIVE_BYPASS_TAB_KEY);
		}
		return bypass;
	} catch {
		return false;
	}
}

/**
 * 同步创建 about:blank，先写入目标标签自己的绕过信号，再导航到真实原帖 URL。
 */
export function openReaderNativeTopicTab(
	window: Pick<ReaderNativeSourceWindow, 'open'>,
	value: string,
): boolean {
	let tab: ReaderNativeTabWindow | null = null;
	try {
		tab = window.open('about:blank', '_blank');
	} catch {
		return false;
	}
	if (!tab) return false;
	try {
		tab.sessionStorage.setItem(READER_NATIVE_BYPASS_TAB_KEY, '1');
	} catch {
		// URL 参数仍是第一道绕过信号；禁用存储时允许继续导航。
	}
	try {
		tab.opener = null;
	} catch {
		// 浏览器可能把 opener 暴露为只读代理；不影响目标导航。
	}
	try {
		tab.location.replace(value);
	} catch {
		tab.location.href = value;
	}
	return true;
}
