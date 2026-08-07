import { LifecycleScope } from '../kernel/lifecycle.js';
import type {
	ReaderDiscourseSiteProbePort,
} from '../site/browser-discourse-site-probe.js';
import {
	normalizeReaderCustomSiteHost,
	readerBuiltinDiscourseHost,
} from '../site/reader-custom-site-repository.js';
import type {
	ReaderCustomSiteRepository,
} from '../site/reader-custom-site-repository.js';
import {
	settingsButton,
	settingsElement as element,
} from './reader-settings-dom.js';

export interface ReaderCustomSiteSettingsFormOptions {
	readonly document: Document;
	readonly host: HTMLElement;
	readonly repository: ReaderCustomSiteRepository;
	readonly probe: ReaderDiscourseSiteProbePort | null;
	readonly parentScope?: LifecycleScope;
}

/**
 * “适用站点”面板的唯一 DOM owner。
 *
 * 表单只发出验证/增删命令；规范化、持久化和 host gate 均共享 repository，
 * 跨站请求则只能通过固定 endpoint 的 probe。
 */
export class ReaderCustomSiteSettingsForm {
	readonly scope: LifecycleScope;
	readonly #host: HTMLElement;
	readonly #repository: ReaderCustomSiteRepository;
	readonly #probe: ReaderDiscourseSiteProbePort | null;
	readonly #input: HTMLInputElement;
	readonly #add: HTMLButtonElement;
	readonly #list: HTMLElement;
	readonly #status: HTMLElement;
	#operation: AbortController | null = null;
	#epoch = 0;

	constructor(options: ReaderCustomSiteSettingsFormOptions) {
		this.#host = options.host;
		this.#repository = options.repository;
		this.#probe = options.probe;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		const root = element(
			options.document,
			'div',
			'ldp-settings-fields ldp-other-settings-fields ldp-custom-site-settings',
		);
		const section = element(
			options.document,
			'section',
			'ldp-other-setting-group',
		);
		const head = element(
			options.document,
			'header',
			'ldp-other-setting-group-head',
		);
		const title = element(options.document, 'strong');
		title.textContent = '其他适用站点';
		const description = element(options.document, 'small');
		description.textContent =
			'添加其他 HTTPS Discourse 论坛；保存前只会匿名检测公开站点信息。';
		head.append(title, description);
		const form = element(
			options.document,
			'form',
			'ldp-custom-site-form',
		);
		this.#input = element(
			options.document,
			'input',
			'ldp-boost-rule-control ldp-custom-site-input',
		);
		this.#input.type = 'text';
		this.#input.inputMode = 'url';
		this.#input.setAttribute('autocomplete', 'url');
		this.#input.placeholder = '论坛域名或 HTTPS 网址';
		this.#input.setAttribute('aria-label', '论坛域名或 HTTPS 网址');
		this.#add = settingsButton(
			options.document,
			'ldp-config-action ldp-custom-site-add',
			'验证并添加 Discourse 站点',
			'plus',
			'验证并添加',
		);
		this.#add.type = 'submit';
		form.append(this.#input, this.#add);
		this.#list = element(
			options.document,
			'div',
			'ldp-custom-site-list',
		);
		this.#list.setAttribute('aria-label', '已添加的自定义站点');
		this.#list.hidden = true;
		this.#status = element(
			options.document,
			'small',
			'ldp-custom-site-status',
		);
		this.#status.role = 'status';
		this.#status.setAttribute('aria-live', 'polite');
		this.#status.textContent = '正在读取已保存站点…';
		section.append(head, form, this.#list, this.#status);
		root.append(section);
		this.#host.replaceChildren(root);

		this.scope.listen(form, 'submit', (event) => {
			event.preventDefault();
			void this.#submit();
		});
		this.scope.listen(this.#list, 'click', (event) => {
			const button = (event.target as Element | null)?.closest<
				HTMLButtonElement
			>('[data-custom-site-remove]');
			if (!button?.dataset.customSiteRemove) return;
			void this.#remove(button.dataset.customSiteRemove);
		});
		this.#repository.changes.subscribe(
			(sites) => this.#renderSites(sites),
			this.scope,
		);
		this.scope.add(() => {
			this.#epoch += 1;
			this.#operation?.abort(new Error('适用站点设置已关闭'));
			this.#operation = null;
			this.#host.replaceChildren();
		});
		void this.#load();
	}

	destroy(): void {
		this.scope.destroy();
	}

	async #load(): Promise<void> {
		try {
			const sites = await this.#repository.load();
			if (this.scope.destroyed) return;
			this.#renderSites(sites);
			if (!this.#repository.writable) {
				this.#status.textContent =
					'脚本没有全局站点存储权限，当前只能使用内置站点。';
				this.#input.disabled = true;
				this.#add.disabled = true;
			} else if (!this.#probe) {
				this.#status.textContent =
					'脚本没有跨站检测权限，暂时不能添加站点。';
				this.#input.disabled = true;
				this.#add.disabled = true;
			} else {
				this.#status.textContent =
					'输入域名即可，例如 forum.example.com。';
			}
		} catch (cause) {
			if (this.scope.destroyed) return;
			this.#status.textContent = cause instanceof Error
				? `读取站点失败：${cause.message}`
				: '读取站点失败。';
			this.#input.disabled = true;
			this.#add.disabled = true;
		}
	}

	async #submit(): Promise<void> {
		if (
			this.scope.destroyed ||
			this.#add.disabled ||
			!this.#probe
		) return;
		const host = normalizeReaderCustomSiteHost(this.#input.value);
		if (!host) {
			this.#status.textContent = '请输入有效的 HTTPS 域名或网址。';
			return;
		}
		if (readerBuiltinDiscourseHost(host)) {
			this.#status.textContent =
				`${host} 已内置支持，无需重复添加。`;
			return;
		}
		if (this.#repository.snapshot.includes(host)) {
			this.#status.textContent = `${host} 已在适用站点列表中。`;
			return;
		}
		const epoch = ++this.#epoch;
		this.#operation?.abort(new Error('开始新的站点检测'));
		const operation = new AbortController();
		this.#operation = operation;
		this.#input.disabled = true;
		this.#add.disabled = true;
		this.#add.setAttribute('aria-busy', 'true');
		this.#status.textContent = '正在检测 Discourse…';
		try {
			const info = await this.#probe.probe(host, operation.signal);
			await this.#repository.add(host);
			if (this.scope.destroyed || epoch !== this.#epoch) return;
			this.#input.value = '';
			this.#status.textContent =
				`已添加 ${info.title || host}，访问该站即可使用。`;
		} catch (cause) {
			if (
				this.scope.destroyed ||
				epoch !== this.#epoch ||
				operation.signal.aborted
			) return;
			this.#status.textContent = `${
				cause instanceof Error ? cause.message : '检测失败'
			}；仅支持 Discourse 论坛。`;
		} finally {
			if (!this.scope.destroyed && epoch === this.#epoch) {
				this.#operation = null;
				this.#input.disabled = false;
				this.#add.disabled = false;
				this.#add.removeAttribute('aria-busy');
			}
		}
	}

	async #remove(host: string): Promise<void> {
		if (this.scope.destroyed) return;
		try {
			await this.#repository.remove(host);
			if (!this.scope.destroyed) {
				this.#status.textContent = `已移除 ${host}。`;
			}
		} catch (cause) {
			if (!this.scope.destroyed) {
				this.#status.textContent = cause instanceof Error
					? `移除失败：${cause.message}`
					: '移除失败。';
			}
		}
	}

	#renderSites(sites: readonly string[]): void {
		this.#list.replaceChildren(...sites.map((host) => {
			const item = element(
				this.#host.ownerDocument,
				'span',
				'ldp-custom-site-item',
			);
			const label = element(this.#host.ownerDocument, 'span');
			label.textContent = host;
			const remove = settingsButton(
				this.#host.ownerDocument,
				'ldp-custom-site-remove',
				`移除 ${host}`,
				'x',
			);
			remove.dataset.customSiteRemove = host;
			item.append(label, remove);
			return item;
		}));
		this.#list.hidden = sites.length === 0;
	}
}
