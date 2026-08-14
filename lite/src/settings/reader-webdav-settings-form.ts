import { LifecycleScope } from '../kernel/lifecycle.js';
import type { ReaderWebDavConfigRepository } from
	'../sync/reader-webdav-config-repository.js';
import type { ReaderWebDavCoordinator } from
	'../sync/reader-webdav-coordinator.js';
import {
	READER_WEBDAV_CATEGORIES,
	READER_WEBDAV_CATEGORY_LABELS,
	normalizeReaderWebDavConfig,
	validateReaderWebDavConfig,
	type ReaderWebDavAutoSyncIntervalMinutes,
	type ReaderWebDavCategory,
	type ReaderWebDavConfig,
} from '../sync/reader-webdav-model.js';
import {
	settingsButton,
	settingsElement as element,
	settingsOption,
	settingsOptionRow,
	settingsSection,
	settingsSwitch,
} from './reader-settings-dom.js';

export interface ReaderWebDavSettingsFormOptions {
	readonly document: Document;
	readonly host: HTMLElement;
	readonly repository: ReaderWebDavConfigRepository;
	readonly coordinator: ReaderWebDavCoordinator;
	readonly unavailableReason?: string | (() => string);
	readonly parentScope?: LifecycleScope;
}

function field(
	document: Document,
	labelText: string,
	type: 'text' | 'password',
	placeholder: string,
): Readonly<{ root: HTMLElement; input: HTMLInputElement }> {
	const root = element(document, 'label', 'ldp-webdav-field');
	const label = element(document, 'strong');
	label.textContent = labelText;
	const input = element(document, 'input', 'ldp-boost-rule-control');
	input.type = type;
	input.placeholder = placeholder;
	input.setAttribute('aria-label', labelText);
	input.autocomplete = 'off';
	root.append(label, input);
	return Object.freeze({ root, input });
}

/** WebDAV 配置、分类、手动动作和定时策略的唯一设置 DOM owner。 */
export class ReaderWebDavSettingsForm {
	readonly scope: LifecycleScope;
	readonly #host: HTMLElement;
	readonly #repository: ReaderWebDavConfigRepository;
	readonly #coordinator: ReaderWebDavCoordinator;
	readonly #endpoint: HTMLInputElement;
	readonly #username: HTMLInputElement;
	readonly #password: HTMLInputElement;
	readonly #remotePath: HTMLInputElement;
	readonly #autoSync: HTMLInputElement;
	readonly #interval: HTMLSelectElement;
	readonly #categories = new Map<ReaderWebDavCategory, HTMLInputElement>();
	readonly #save: HTMLButtonElement;
	readonly #test: HTMLButtonElement;
	readonly #sync: HTMLButtonElement;
	readonly #status: HTMLElement;
	readonly #controls: readonly (
		HTMLInputElement | HTMLSelectElement | HTMLButtonElement
	)[];
	readonly #unavailableReason: () => string;
	#loaded = false;
	#actionPending = false;
	#operation: AbortController | null = null;
	#renderedConfig: ReaderWebDavConfig | null = null;
	#passwordEdited = false;

	constructor(options: ReaderWebDavSettingsFormOptions) {
		this.#host = options.host;
		this.#repository = options.repository;
		this.#coordinator = options.coordinator;
		const unavailableReasonSource = options.unavailableReason;
		this.#unavailableReason = typeof unavailableReasonSource === 'function'
			? () => unavailableReasonSource().trim()
			: () => unavailableReasonSource?.trim() ?? '';
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		const root = element(
			options.document,
			'div',
			'ldp-settings-fields ldp-webdav-settings',
		);
		const connection = settingsSection(
			options.document,
			'连接与文件',
			'兼容坚果云等标准 WebDAV；坚果云请使用应用密码。WebDAV 连接凭据仅保存在脚本专属存储，不写入远端文件。',
			true,
		);
		const endpoint = field(
			options.document,
			'WebDAV 地址',
			'text',
			'https://dav.jianguoyun.com/dav/',
		);
		this.#endpoint = endpoint.input;
		this.#endpoint.inputMode = 'url';
		const username = field(options.document, '用户名', 'text', '账号邮箱');
		this.#username = username.input;
		const password = field(options.document, '应用密码', 'password', '应用密码');
		this.#password = password.input;
		const remotePath = field(
			options.document,
			'远端文件',
			'text',
			'ALR-Lite/v2/sync.json',
		);
		this.#remotePath = remotePath.input;
		connection.append(
			endpoint.root,
			username.root,
			password.root,
			remotePath.root,
		);

		const content = settingsSection(
			options.document,
			'选择同步内容',
			'每类独立开关；关闭的类别不会上传、下载或删除。通知与互动历史、离线 Topic HTML 和译文只在各自单独勾选后同步。历史清单只含可搜索记录，不上传原始分页响应、请求游标或限流状态。',
			true,
		);
		const categoryList = element(
			options.document,
			'div',
			'ldp-webdav-category-list',
		);
		for (const category of READER_WEBDAV_CATEGORIES) {
			const control = settingsSwitch(
				options.document,
				`同步${READER_WEBDAV_CATEGORY_LABELS[category]}`,
			);
			this.#categories.set(category, control.input);
			categoryList.append(settingsOptionRow(
				options.document,
				READER_WEBDAV_CATEGORY_LABELS[category],
				this.#categoryDescription(category),
				control.root,
			));
		}
		content.append(categoryList);

		const automatic = settingsSection(
			options.document,
			'定时同步',
			'默认关闭；启用后仅在页面可见时执行，启动后等待 30 秒，再按所选间隔串行同步。',
			true,
		);
		const autoControl = settingsSwitch(options.document, '启用定时同步');
		this.#autoSync = autoControl.input;
		automatic.append(settingsOptionRow(
			options.document,
			'启用定时同步',
			'手动同步始终可用。',
			autoControl.root,
		));
		this.#interval = element(
			options.document,
			'select',
			'ldp-webdav-interval',
		);
		for (const [value, label] of [
			['15', '每 15 分钟'],
			['30', '每 30 分钟'],
			['60', '每 1 小时'],
			['180', '每 3 小时'],
			['360', '每 6 小时'],
		] as const) this.#interval.append(settingsOption(options.document, value, label));
		automatic.append(settingsOptionRow(
			options.document,
			'同步间隔',
			'坚果云按请求计数，建议 1 小时。',
			this.#interval,
		));

		const actions = element(options.document, 'div', 'ldp-webdav-actions');
		this.#save = settingsButton(
			options.document,
			'ldp-config-action',
			'保存 WebDAV 设置',
			'check',
			'保存设置',
		);
		this.#test = settingsButton(
			options.document,
			'ldp-config-action',
			'测试 WebDAV 连接',
			'activity',
			'测试连接',
		);
		this.#sync = settingsButton(
			options.document,
			'ldp-config-action is-primary',
			'立即执行 WebDAV 合并同步',
			'upload',
			'立即同步',
		);
		actions.append(this.#save, this.#test, this.#sync);
		this.#status = element(options.document, 'small', 'ldp-webdav-status');
		this.#status.role = 'status';
		this.#status.setAttribute('aria-live', 'polite');
		root.append(connection, content, automatic, actions, this.#status);
		this.#controls = Object.freeze([
			...root.querySelectorAll<
				HTMLInputElement | HTMLSelectElement | HTMLButtonElement
			>('input, select, button'),
		]);
		this.#syncIntervalState();
		const unavailableReason = this.#unavailableReason();
		this.#renderStatus(
			unavailableReason ? 'error' : 'idle',
			unavailableReason || '正在读取 WebDAV 设置…',
		);
		this.#host.replaceChildren(root);

		this.scope.listen(this.#autoSync, 'change', () => this.#syncIntervalState());
		this.scope.listen(this.#password, 'input', () => {
			this.#passwordEdited = true;
		});
		this.scope.listen(this.#save, 'click', () => void this.#saveConfig());
		this.scope.listen(this.#test, 'click', () => void this.#run('test'));
		this.scope.listen(this.#sync, 'click', () => void this.#run('sync'));
		this.#repository.changes.subscribe((snapshot) => {
			this.#renderConfig(snapshot.config);
			const unavailableReason = this.#unavailableReason();
			this.#renderStatus(
				unavailableReason ? 'error' : snapshot.status.kind,
				unavailableReason || snapshot.status.message,
			);
		}, this.scope);
		this.scope.add(() => {
			this.#operation?.abort(new Error('WebDAV 设置已关闭'));
			this.#host.replaceChildren();
		});
		void this.#load();
	}

	destroy(): void {
		this.scope.destroy();
	}

	/** 设置页重新显示时刷新 Discourse 会话门禁，避免固化启动阶段的匿名快照。 */
	refreshAvailability(): void {
		if (this.scope.destroyed) return;
		const unavailableReason = this.#unavailableReason();
		if (unavailableReason) {
			this.#operation?.abort(new Error(unavailableReason));
		}
		this.#syncIntervalState();
		this.#renderStatus(
			unavailableReason ? 'error' : this.#loaded
				? this.#repository.snapshot.status.kind
				: 'idle',
			unavailableReason || (this.#loaded
				? this.#repository.snapshot.status.message ||
					'填写连接信息后先测试连接，再执行合并同步。'
				: '正在读取 WebDAV 设置…'),
		);
	}

	#categoryDescription(category: ReaderWebDavCategory): string {
		return ({
			history: '主题、最近阅读楼层、已读楼层和查看时间。',
			bookmarks: '收藏链接、标题及定位信息；不修改原站收藏。',
			'notification-history': '逐条通知历史与搜索字段；不含私信、未读状态或原生通知 ID。独立文件，默认关闭。',
			'activity-history': '回复、Boost 与表情回应历史；独立文件单调合并，默认关闭，不为同步额外请求 Discourse。',
			preferences: 'Lite 外观、布局、性能与阅读交互设置；不含 WebDAV 凭据。',
			queue: '队列主题链接、固定状态和入口楼层；不含帖子正文。',
			'topic-context': '最近阅读位置、讨论窗口锚点和全屏窗口几何。',
			'custom-sites': '用户添加的其他 HTTPS Discourse 站点。',
			'connect-history': '本机观察的 Connect 指标历史与服务器确认已读指纹。',
			translation: '可包含任意数量的 URL、模型、思考等级与 Prompt；只加密每个 URL 对应的 API Key。',
			'translation-cache': '最近使用的已翻译正文 Section；普通同步并合并写回中央缓存，不包含原文。',
			'offline-topics': '下载历史与完整离线 HTML；默认关闭。每个 Topic 以独立明文 HTML 文件存入你的 WebDAV，不占用 2 MiB 主同步文件；图片与附件仍保留原 URL。',
		})[category];
	}

	async #load(): Promise<void> {
		try {
			const snapshot = await this.#repository.load();
			if (this.scope.destroyed) return;
			this.#renderConfig(snapshot.config);
			this.#loaded = true;
			this.#syncIntervalState();
			const unavailableReason = this.#unavailableReason();
			this.#renderStatus(
				unavailableReason ? 'error' : snapshot.status.kind,
				unavailableReason || snapshot.status.message ||
					'填写连接信息后先测试连接，再执行合并同步。',
			);
		} catch (cause) {
			if (this.scope.destroyed) return;
			this.#renderStatus('error', this.#unavailableReason() || (
				cause instanceof Error ? cause.message : 'WebDAV 设置读取失败'
			));
		}
	}

	#draft() {
		const candidate = normalizeReaderWebDavConfig({
			endpoint: this.#endpoint.value,
			username: this.#username.value,
			password: '',
			remotePath: this.#remotePath.value,
			autoSyncEnabled: this.#autoSync.checked,
			autoSyncIntervalMinutes: Number(
				[...this.#interval.options].find((option) => option.selected)?.value ??
				this.#interval.value,
			) as
				ReaderWebDavAutoSyncIntervalMinutes,
			categories: Object.fromEntries(READER_WEBDAV_CATEGORIES.map(
				(category) => [category, this.#categories.get(category)!.checked],
			)),
		});
		const rendered = this.#renderedConfig;
		const preservesCredentialTarget = Boolean(
			rendered &&
			candidate.endpoint === rendered.endpoint &&
			candidate.username === rendered.username,
		);
		return normalizeReaderWebDavConfig({
			...candidate,
			password: this.#password.value || (
				!this.#passwordEdited && preservesCredentialTarget
					? rendered!.password
					: ''
			),
		});
	}

	#renderConfig(config: ReaderWebDavConfig): void {
		if (this.#renderedConfig === config) return;
		this.#endpoint.value = config.endpoint;
		this.#username.value = config.username;
		// 已保存密码只留在 userscript 存储；同目标留空保存时由 #draft 复用，
		// 不把秘密回填到宿主页面 DOM 或交给站点密码管理器识别。
		this.#password.value = '';
		this.#password.placeholder = config.password
			? '已保存，留空保持不变'
			: '应用密码';
		this.#passwordEdited = false;
		this.#remotePath.value = config.remotePath;
		this.#autoSync.checked = config.autoSyncEnabled;
		for (const option of this.#interval.options) {
			option.toggleAttribute(
				'selected',
				option.value === String(config.autoSyncIntervalMinutes),
			);
		}
		for (const category of READER_WEBDAV_CATEGORIES) {
			this.#categories.get(category)!.checked = config.categories[category];
		}
		this.#renderedConfig = config;
		if (this.#loaded) this.#syncIntervalState();
	}

	async #saveConfig(): Promise<boolean> {
		if (!this.#beginAction()) return false;
		try {
			return await this.#persistDraft(true);
		} finally {
			this.#finishAction();
		}
	}

	async #persistDraft(showSavedStatus: boolean): Promise<boolean> {
		const unavailableReason = this.#unavailableReason();
		if (unavailableReason) {
			this.#renderStatus('error', unavailableReason);
			return false;
		}
		const config = this.#draft();
		const issues = validateReaderWebDavConfig(config, {
			requireCredentials: config.autoSyncEnabled,
		});
		if (issues.length) {
			this.#renderStatus('error', issues[0]!);
			return false;
		}
		try {
			await this.#repository.saveConfig(config);
		} catch (cause) {
			if (!this.scope.destroyed) this.#renderStatus(
				'error',
				cause instanceof Error ? cause.message : 'WebDAV 设置保存失败',
			);
			return false;
		}
		if (this.scope.destroyed) return false;
		const savedConfig = this.#repository.snapshot.config;
		this.#password.value = '';
		this.#password.placeholder = savedConfig.password
			? '已保存，留空保持不变'
			: '应用密码';
		this.#passwordEdited = false;
		const unavailableReasonAfterSave = this.#unavailableReason();
		if (unavailableReasonAfterSave) {
			this.#renderStatus('error', unavailableReasonAfterSave);
			return false;
		}
		if (showSavedStatus) {
			this.#renderStatus('success', 'WebDAV 设置已保存。');
		}
		return true;
	}

	async #run(kind: 'test' | 'sync'): Promise<void> {
		if (!this.#beginAction()) return;
		const operation = new AbortController();
		let operationConfig: ReaderWebDavConfig | null = null;
		this.#operation = operation;
		try {
			if (
				!(await this.#persistDraft(false)) ||
				this.scope.destroyed ||
				operation.signal.aborted
			) return;
			operationConfig = this.#repository.snapshot.config;
			const issues = validateReaderWebDavConfig(
				operationConfig,
				{ requireCredentials: true },
			);
			if (issues.length) {
				this.#renderStatus('error', issues[0]!);
				return;
			}
			this.#renderStatus('syncing', kind === 'test'
				? '正在测试 WebDAV 连接…'
				: '正在读取远端、合并并条件写入…');
			if (kind === 'test') {
				await this.#coordinator.testConnection(operation.signal);
				if (this.#repository.snapshot.config === operationConfig) {
					this.#renderStatus('success', '连接成功，WebDAV 账号和地址可用。');
				}
			} else {
				await this.#coordinator.syncNow(operation.signal);
			}
		} catch (cause) {
			if (
				!operation.signal.aborted &&
				(operationConfig === null ||
					this.#repository.snapshot.config === operationConfig)
			) this.#renderStatus(
				'error',
				cause instanceof Error ? cause.message : 'WebDAV 操作失败',
			);
		} finally {
			if (this.#operation === operation) {
				this.#operation = null;
			}
			this.#finishAction();
		}
	}

	#beginAction(): boolean {
		if (this.scope.destroyed || !this.#loaded || this.#actionPending) return false;
		this.#actionPending = true;
		this.#setBusy(true);
		return true;
	}

	#finishAction(): void {
		this.#actionPending = false;
		if (!this.scope.destroyed) this.#syncIntervalState();
	}

	#setBusy(busy: boolean): void {
		const unavailable = Boolean(this.#unavailableReason());
		for (const control of this.#controls) {
			control.disabled = !this.#loaded || busy || unavailable;
		}
		if (this.#loaded && !busy && !unavailable) {
			this.#interval.disabled = !this.#autoSync.checked;
		}
		for (const button of [this.#save, this.#test, this.#sync]) {
			button.setAttribute('aria-busy', String(busy));
		}
	}

	#syncIntervalState(): void {
		this.#setBusy(this.#actionPending);
	}

	#renderStatus(kind: string, message: string): void {
		this.#status.dataset.statusKind = kind;
		this.#status.textContent = message;
	}
}
