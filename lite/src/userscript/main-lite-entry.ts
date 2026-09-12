import {
	startMainLiteUserscript,
} from './main-lite-bootstrap.js';

declare const unsafeWindow: unknown;
declare const GM: unknown;
declare const GM_info: unknown;
declare const GM_getValue: unknown;
declare const GM_setValue: unknown;
declare const GM_addValueChangeListener: unknown;
declare const GM_removeValueChangeListener: unknown;
declare const GM_xmlhttpRequest: unknown;
declare const GM_addElement: unknown;
declare const GM_getResourceText: unknown;
declare const katex: unknown;
declare const Hls: unknown;
declare const pinyinPro: unknown;

function callable(value: unknown): unknown {
	return typeof value === 'function'
		? (...args: unknown[]) => Reflect.apply(value, globalThis, args)
		: undefined;
}

// 部分移动脚本管理器将 GM API 注入局部作用域，且 Window 含只读访问器。
// 显式构造普通对象，既保留这些接口，也不继承或修改浏览器的 Window。
startMainLiteUserscript({
	window,
	unsafeWindow: typeof unsafeWindow === 'undefined' ? window : unsafeWindow,
	GM: typeof GM === 'undefined' ? undefined : GM,
	GM_info: typeof GM_info === 'undefined' ? undefined : GM_info,
	GM_getValue: callable(typeof GM_getValue === 'undefined' ? undefined : GM_getValue),
	GM_setValue: callable(typeof GM_setValue === 'undefined' ? undefined : GM_setValue),
	GM_addValueChangeListener: callable(typeof GM_addValueChangeListener === 'undefined' ? undefined : GM_addValueChangeListener),
	GM_removeValueChangeListener: callable(typeof GM_removeValueChangeListener === 'undefined' ? undefined : GM_removeValueChangeListener),
	GM_xmlhttpRequest: callable(typeof GM_xmlhttpRequest === 'undefined' ? undefined : GM_xmlhttpRequest),
	GM_addElement: callable(typeof GM_addElement === 'undefined' ? undefined : GM_addElement),
	GM_getResourceText: callable(typeof GM_getResourceText === 'undefined' ? undefined : GM_getResourceText),
	katex: typeof katex === 'undefined' ? undefined : katex,
	Hls: typeof Hls === 'undefined' ? undefined : Hls,
	pinyinPro: typeof pinyinPro === 'undefined' ? undefined : pinyinPro,
});
