export const READER_NATIVE_BYPASS_PARAMETER = 'ldp_native';

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
