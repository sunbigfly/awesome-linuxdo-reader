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
	readonly siteAccess?: ReaderCustomSiteAccessPort | null;
	readonly clipboard?: ReaderCustomSiteClipboardPort | null;
	readonly parentScope?: LifecycleScope;
}

export interface ReaderCustomSiteAccessPort {
	request(host: string): Promise<boolean>;
	remove(host: string): Promise<void>;
}

/**
 * 面板“复制匹配规则”能力。
 *
 * 只暴露复制文本，不拥有 URL 或提示语义；缺失时面板仍展示完整规则文本，
 * 由用户手动选取复制，不改变任何匹配权限。
 */
export interface ReaderCustomSiteClipboardPort {
	copyText(text: string): Promise<void>;
}

/**
 * 自定义站点在脚本管理器“用户匹配”中需要的规则文本，是面板展示与复制的唯一来源。
 */
export function readerCustomSiteMatchPattern(host: string): string {
	return `https://${host}/*`;
}

/**
 * “适用站点”面板的唯一 DOM owner。
 *
 * 表单只发出验证/增删命令；规范化、持久化和已验证站点兜底共享 repository，
 * 跨站请求则只能通过固定 endpoint 的 probe。保存站点不会修改 userscript 元数据权限。
 */
export class ReaderCustomSiteSettingsForm {
	readonly scope: LifecycleScope;
	readonly #host: HTMLElement;
	readonly #repository: ReaderCustomSiteRepository;
	readonly #probe: ReaderDiscourseSiteProbePort | null;
	readonly #siteAccess: ReaderCustomSiteAccessPort | null;
	readonly #clipboard: ReaderCustomSiteClipboardPort | null;
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
		this.#siteAccess = options.siteAccess ?? null;
		this.#clipboard = options.clipboard ?? null;
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
		description.textContent = this.#siteAccess
			? '添加 HTTPS Discourse 后，浏览器会请求该域名的精确站点权限。'
			: 'Loader 默认仅运行于内置社区；额外获准运行的 Discourse 会提示保存，也可在此手动验证。';
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
		if (this.#siteAccess) {
			section.append(head, form, this.#list, this.#status);
		} else {
			// 纯 userscript 无法自行追加 @match：把管理器 GUI 步骤和可复制规则
			// 直接放在面板里，用户不需要编辑 Loader 元数据。
			const guidance = element(
				options.document,
				'small',
				'ldp-custom-site-guidance',
			);
			guidance.textContent =
				'在脚本管理器中添加用户匹配：Tampermonkey → 本脚本 → 设置 → 用户匹配，粘贴站点右侧的规则并确认。';
			section.append(head, form, guidance, this.#list, this.#status);
		}
		root.append(section);
		this.#host.replaceChildren(root);

		this.scope.listen(form, 'submit', (event) => {
			event.preventDefault();
			void this.#submit();
		});
		this.scope.listen(this.#list, 'click', (event) => {
			const target = (event.target as Element | null)?.closest<
				HTMLButtonElement
			>('[data-custom-site-copy], [data-custom-site-remove]');
			if (!target) return;
			const copyHost = target.dataset.customSiteCopy;
			if (copyHost) {
				void this.#copy(copyHost);
				return;
			}
			if (!target.dataset.customSiteRemove) return;
			void this.#remove(target.dataset.customSiteRemove);
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
					'当前页面仍可本地识别；脚本没有权限保存兼容兜底站点。';
				this.#input.disabled = true;
				this.#add.disabled = true;
			} else if (!this.#probe) {
				this.#status.textContent =
					'当前页面仍可本地识别；脚本没有权限验证兼容兜底站点。';
				this.#input.disabled = true;
				this.#add.disabled = true;
			} else {
				this.#status.textContent = this.#siteAccess
					? '添加时浏览器会弹出一次站点权限确认。'
					: '添加后仍需在脚本管理器中允许该域名运行。';
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
		const alreadySaved = this.#repository.snapshot.includes(host);
		const epoch = ++this.#epoch;
		this.#operation?.abort(new Error('开始新的站点检测'));
		const operation = new AbortController();
		this.#operation = operation;
		this.#input.disabled = true;
		this.#add.disabled = true;
		this.#add.setAttribute('aria-busy', 'true');
		this.#status.textContent = this.#siteAccess
			? '正在请求浏览器站点权限…'
			: '正在检测 Discourse…';
		let accessGranted = false;
		try {
			if (this.#siteAccess) {
				accessGranted = await this.#siteAccess.request(host);
				if (!accessGranted) {
					throw new Error('未授予该站点的浏览器权限');
				}
				if (this.scope.destroyed || epoch !== this.#epoch) return;
				this.#status.textContent = alreadySaved
					? '正在恢复站点运行权限…'
					: '正在检测 Discourse…';
			}
			if (alreadySaved) {
				this.#status.textContent = this.#siteAccess
					? `已允许 ${readerCustomSiteMatchPattern(host)}；刷新该站点即可运行。`
					: `${host} 已在兼容兜底列表中。`;
				return;
			}
			const info = await this.#probe.probe(host, operation.signal);
			await this.#repository.add(host);
			if (this.scope.destroyed || epoch !== this.#epoch) return;
			this.#input.value = '';
			const pattern = readerCustomSiteMatchPattern(host);
			this.#status.textContent = this.#siteAccess
				? `已添加 ${info.title || host}；浏览器已允许 ${pattern}，刷新该站点即可运行。`
				: `已添加 ${info.title || host}；请复制 ${pattern} 添加到脚本管理器“用户匹配”。`;
		} catch (cause) {
			if (
				this.scope.destroyed ||
				epoch !== this.#epoch ||
				operation.signal.aborted
			) return;
			if (accessGranted && !alreadySaved) {
				void this.#siteAccess?.remove(host).catch(() => {});
			}
			this.#status.textContent = `${
				cause instanceof Error ? cause.message : '检测失败'
			}${accessGranted ? '；仅支持 Discourse 论坛。' : '。'}`;
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
			await this.#siteAccess?.remove(host);
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
			item.append(label);
			if (!this.#siteAccess) {
				// 扩展会自行注册内容脚本；只有纯 userscript 需要把规则交给管理器。
				const rule = element(
					this.#host.ownerDocument,
					'code',
					'ldp-custom-site-rule',
				);
				rule.textContent = readerCustomSiteMatchPattern(host);
				item.append(rule);
				if (this.#clipboard) {
					const copy = settingsButton(
						this.#host.ownerDocument,
						'ldp-custom-site-copy',
						`复制 ${host} 的用户匹配规则`,
						'copy',
						'复制规则',
					);
					copy.dataset.customSiteCopy = host;
					item.append(copy);
				}
			}
			const remove = settingsButton(
				this.#host.ownerDocument,
				'ldp-custom-site-remove',
				`移除 ${host}`,
				'x',
			);
			remove.dataset.customSiteRemove = host;
			item.append(remove);
			return item;
		}));
		this.#list.hidden = sites.length === 0;
	}

	async #copy(host: string): Promise<void> {
		if (this.scope.destroyed || !this.#clipboard) return;
		const pattern = readerCustomSiteMatchPattern(host);
		try {
			await this.#clipboard.copyText(pattern);
			if (!this.scope.destroyed) {
				this.#status.textContent =
					`已复制 ${pattern}；请在脚本管理器“用户匹配”中粘贴并确认。`;
			}
		} catch {
			if (!this.scope.destroyed) {
				this.#status.textContent =
					`复制失败，请手动复制 ${pattern}。`;
			}
		}
	}
}
