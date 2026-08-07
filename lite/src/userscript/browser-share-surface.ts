import type {
	ReaderShareSurfacePort,
} from '../post/reader-share-action-coordinator.js';
import {
	valueRecord as record,
	type UnknownRecord,
} from '../kernel/value-record.js';

/**
 * Web Share 与 Clipboard 的唯一 userscript 浏览器能力桥。
 *
 * 它只绑定 page window 的原生 navigator，不读取 Reader DOM，也不实现 URL 或提示语义。
 */
export class BrowserReaderShareSurface implements ReaderShareSurfacePort {
	readonly #navigator: UnknownRecord;

	constructor(pageWindow: unknown) {
		const page = record(pageWindow);
		this.#navigator = record(page?.navigator) ?? Object.freeze({});
	}

	async share(input: Readonly<{
		readonly title: string;
		readonly url: string;
	}>): Promise<'shared' | 'unsupported' | 'cancelled'> {
		const share = this.#navigator.share;
		if (typeof share !== 'function') return 'unsupported';
		try {
			await share.call(this.#navigator, input);
			return 'shared';
		} catch (cause) {
			if (record(cause)?.name === 'AbortError') return 'cancelled';
			throw cause;
		}
	}

	async copyText(text: string): Promise<void> {
		const clipboard = record(this.#navigator.clipboard);
		const writeText = clipboard?.writeText;
		if (typeof writeText !== 'function') {
			throw new Error('浏览器剪贴板不可用');
		}
		await writeText.call(clipboard, text);
	}
}
