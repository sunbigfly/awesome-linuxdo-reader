export type UnknownRecord = Readonly<Record<string, unknown>>;
export type MutableUnknownRecord = Record<string, unknown>;

/**
 * 将 Discourse/浏览器运行时值收窄为可按键读取的对象。
 *
 * 保留原生模型和 service 可能以 function 承载属性的情况；数组同样是对象，
 * 是否接受数组应由调用方在读取具体字段时决定。
 */
export function valueRecord(value: unknown): MutableUnknownRecord | null {
	return value !== null &&
		(typeof value === 'object' || typeof value === 'function')
		? value as MutableUnknownRecord
		: null;
}

/**
 * 收窄 JSON/响应载荷中的对象值；与 valueRecord 不同，它不接受 function。
 */
export function objectRecord(value: unknown): MutableUnknownRecord | null {
	return value !== null && typeof value === 'object'
		? value as MutableUnknownRecord
		: null;
}
