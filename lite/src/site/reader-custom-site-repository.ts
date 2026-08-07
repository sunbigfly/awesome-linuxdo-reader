import { Signal } from '../kernel/signal.js';

export const READER_CUSTOM_SITES_STORAGE_KEY =
	'awesome-linuxdo-reader:custom-discourse-sites:v1';

export const READER_BUILTIN_DISCOURSE_HOSTS = Object.freeze([
	'linux.do',
	'community.brave.com',
	'devforum.roblox.com',
	'community.openai.com',
	'community.home-assistant.io',
	'forum.cfx.re',
	'community.spiceworks.com',
	'forum.arduino.cc',
	'discussions.unity.com',
	'community.cloudflare.com',
	'forums.unrealengine.com',
	'forum.obsidian.md',
	'forum.cursor.com',
	'forum.godotengine.org',
	'community.n8n.io',
	'forum.mikrotik.com',
	'meta.discourse.org',
	'discuss.python.org',
	'forums.swift.org',
	'discourse.julialang.org',
	'users.rust-lang.org',
]);

const READER_BUILTIN_DISCOURSE_NAMES: Readonly<Record<string, string>> =
	Object.freeze({
		'linux.do': 'LINUX DO',
		'community.openai.com': 'OpenAI Community',
		'community.brave.com': 'Brave Community',
		'devforum.roblox.com': 'Roblox Developer Forum',
		'forum.cfx.re': 'Cfx.re Forum',
		'community.spiceworks.com': 'Spiceworks Community',
		'discussions.unity.com': 'Unity Discussions',
		'community.cloudflare.com': 'Cloudflare Community',
		'forums.unrealengine.com': 'Epic Developer Community',
		'forum.obsidian.md': 'Obsidian Forum',
		'forum.cursor.com': 'Cursor Community',
		'forum.godotengine.org': 'Godot Forum',
		'community.n8n.io': 'n8n Community',
		'forum.mikrotik.com': 'MikroTik Forum',
		'meta.discourse.org': 'Discourse Meta',
		'discuss.python.org': 'Python Discussions',
		'forums.swift.org': 'Swift Forums',
		'discourse.julialang.org': 'Julia Discourse',
		'community.home-assistant.io': 'Home Assistant Community',
		'forum.arduino.cc': 'Arduino Forum',
		'users.rust-lang.org': 'Rust Users Forum',
	});

const builtinHosts = new Set(READER_BUILTIN_DISCOURSE_HOSTS);

export interface ReaderCustomSiteStoragePort {
	getValue(key: string): unknown | Promise<unknown>;
	setValue(key: string, value: unknown): void | Promise<void>;
}

export interface ReaderCustomSiteRepositoryOptions {
	readonly storage: ReaderCustomSiteStoragePort | null;
	readonly storageKey?: string;
}

export function normalizeReaderCustomSiteHost(value: unknown): string {
	const source = String(value ?? '').trim();
	if (!source) return '';
	try {
		const url = new URL(
			/^[a-z][a-z\d+.-]*:\/\//i.test(source)
				? source
				: `https://${source}`,
		);
		if (
			url.protocol !== 'https:' ||
			url.username ||
			url.password ||
			!url.hostname
		) {
			return '';
		}
		return url.hostname.toLowerCase();
	} catch {
		return '';
	}
}

export function readerBuiltinDiscourseHost(value: unknown): boolean {
	return builtinHosts.has(normalizeReaderCustomSiteHost(value));
}

export function readerDiscourseSiteDisplayName(value: unknown): string {
	const host = normalizeReaderCustomSiteHost(value);
	return READER_BUILTIN_DISCOURSE_NAMES[host] ?? host;
}

/**
 * 与现行 main.js 的站点适配器语言门保持一致：只有内置中文站点 LINUX DO
 * 隐藏正文翻译；英文内置站点和语言未知的通用 Discourse 站点都保留入口。
 */
export function readerDiscourseSiteAllowsBodyTranslation(
	value: unknown,
): boolean {
	return normalizeReaderCustomSiteHost(value) !== 'linux.do';
}

function normalizedSites(value: unknown): readonly string[] {
	if (!Array.isArray(value)) return Object.freeze([]);
	return Object.freeze([
		...new Set(value
			.map(normalizeReaderCustomSiteHost)
			.filter((host) => host && !builtinHosts.has(host))),
	].sort());
}

/**
 * 自定义 Discourse host 列表的唯一持久化 owner。
 *
 * 它只保存规范化 hostname；验证请求由独立 probe 完成，运行时 host gate 与设置面板
 * 共享同一份 load/snapshot，避免一边允许启动、一边显示另一份列表。
 */
export class ReaderCustomSiteRepository {
	readonly changes = new Signal<readonly string[]>();
	readonly #storage: ReaderCustomSiteStoragePort | null;
	readonly #storageKey: string;
	#sites: readonly string[] = Object.freeze([]);
	#loaded = false;
	#loadPromise: Promise<readonly string[]> | null = null;
	#writeTail: Promise<void> = Promise.resolve();

	constructor(options: ReaderCustomSiteRepositoryOptions) {
		this.#storage = options.storage;
		this.#storageKey =
			options.storageKey ?? READER_CUSTOM_SITES_STORAGE_KEY;
	}

	get writable(): boolean {
		return this.#storage !== null;
	}

	get snapshot(): readonly string[] {
		return this.#sites;
	}

	async load(): Promise<readonly string[]> {
		if (this.#loaded) return this.#sites;
		if (this.#loadPromise) return this.#loadPromise;
		this.#loadPromise = (async () => {
			const stored = this.#storage
				? await this.#storage.getValue(this.#storageKey)
				: [];
			this.#sites = normalizedSites(stored);
			this.#loaded = true;
			this.changes.emit(this.#sites);
			return this.#sites;
		})();
		try {
			return await this.#loadPromise;
		} finally {
			this.#loadPromise = null;
		}
	}

	async allows(value: unknown): Promise<boolean> {
		const host = normalizeReaderCustomSiteHost(value);
		if (!host) return false;
		if (builtinHosts.has(host)) return true;
		return (await this.load()).includes(host);
	}

	async add(value: unknown): Promise<readonly string[]> {
		const host = normalizeReaderCustomSiteHost(value);
		if (!host) throw new TypeError('请输入有效的 HTTPS 域名或网址');
		if (builtinHosts.has(host)) return this.load();
		const sites = await this.load();
		if (sites.includes(host)) return sites;
		return this.#write([...sites, host]);
	}

	async remove(value: unknown): Promise<readonly string[]> {
		const host = normalizeReaderCustomSiteHost(value);
		if (!host) return this.load();
		const sites = await this.load();
		if (!sites.includes(host)) return sites;
		return this.#write(sites.filter((site) => site !== host));
	}

	async #write(value: readonly string[]): Promise<readonly string[]> {
		if (!this.#storage) {
			throw new Error('脚本没有全局站点存储权限');
		}
		const sites = normalizedSites(value);
		const write = this.#writeTail.then(async () => {
			await this.#storage!.setValue(this.#storageKey, sites);
			this.#sites = sites;
			this.#loaded = true;
			this.changes.emit(this.#sites);
		});
		this.#writeTail = write.catch(() => {});
		await write;
		return this.#sites;
	}
}
