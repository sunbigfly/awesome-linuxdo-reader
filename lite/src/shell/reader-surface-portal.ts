const PORTAL_ID = 'ldp-mian-lite-portal';

/**
 * Reader UI 的唯一 Shadow DOM 边界。
 *
 * 宿主增强仍由 document stylesheet 管理；Reader Shell、面板、帖子与浮层只挂到本 root，
 * 避免 Discourse 主题 CSS 改写组件，同时保留一个可审计、可整体销毁的 surface owner。
 */
export class ReaderSurfacePortal {
	readonly host: HTMLElement;
	readonly root: ShadowRoot;
	readonly style: HTMLStyleElement;
	#destroyed = false;

	constructor(document: Document, stylesheet: string) {
		if (!document.documentElement) {
			throw new Error('Reader Surface Portal 缺少 documentElement');
		}
		if (document.getElementById(PORTAL_ID)) {
			throw new Error('Reader Surface Portal 已存在');
		}
		const host = document.createElement('div');
		host.id = PORTAL_ID;
		host.className = 'ldp-reader-portal-host sciapp-ldp-owned';
		host.dataset.ldpReaderPortal = 'mian-lite';
		const root = host.attachShadow({ mode: 'open' });
		const style = document.createElement('style');
		style.dataset.ldpReaderShadow = 'mian-lite';
		style.textContent = stylesheet;
		root.append(style);
		document.documentElement.append(host);
		this.host = host;
		this.root = root;
		this.style = style;
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.host.remove();
	}
}
