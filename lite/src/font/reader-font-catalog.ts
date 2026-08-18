import type { Cleanup } from '../kernel/lifecycle.js';
import {
	BrowserReaderImportedFontStore,
	type ReaderImportedFontRecord,
	type ReaderImportedFontStorePort,
} from './reader-imported-font-store.js';
import {
	READER_FONT_OPTION_PREVIEW,
	readerLocalFontPresentation,
} from './reader-local-font-catalog.js';

export const READER_FONT_CATALOG_VALUE_PREFIX = 'font-catalog:';
export const READER_IMPORTED_FONT_MAX_BYTES = 32 * 1_024 * 1_024;
export const READER_IMPORTED_FONT_TOTAL_MAX_BYTES = 128 * 1_024 * 1_024;
export const READER_IMPORTED_FONT_MAX_COUNT = 64;

export type ReaderFontCatalogSource = 'google' | 'imported';
export type ReaderFontCatalogScript = 'cjk' | 'latin' | 'code';

export interface ReaderFontCatalogEntry {
	readonly id: string;
	readonly source: ReaderFontCatalogSource;
	readonly label: string;
	readonly family: string;
	readonly fontFamilyCss: string;
	readonly searchText: string;
	readonly scripts: readonly ReaderFontCatalogScript[];
	readonly fileName?: string;
	readonly size?: number;
	readonly googleCssUrl?: string;
}

export interface ReaderFontCatalogPort {
	entries(): Promise<readonly ReaderFontCatalogEntry[]>;
	entry(id: string): ReaderFontCatalogEntry | null;
	findByFamily(family: string): ReaderFontCatalogEntry | null;
	queryLocalFonts?: () => Promise<readonly string[]>;
	ensureLoaded(id: string): Promise<boolean>;
	importFile(file: File): Promise<ReaderFontCatalogEntry>;
	removeImported(id: string): Promise<boolean>;
	subscribe(listener: () => void): Cleanup;
}

export interface ReaderLoadedFontFace {
	readonly face: FontFace;
	readonly remove: () => void;
}

export interface ReaderFontCatalogOptions {
	readonly document: Document;
	readonly indexedDb?: IDBFactory | null;
	readonly queryLocalFonts?: () => Promise<readonly string[]>;
	readonly importedStore?: ReaderImportedFontStorePort;
	readonly now?: () => number;
	readonly randomId?: () => string;
	readonly loadImportedFont?: (
		record: ReaderImportedFontRecord,
	) => Promise<ReaderLoadedFontFace | null>;
	readonly loadGoogleFont?: (
		entry: ReaderFontCatalogEntry,
	) => Promise<boolean>;
	readonly appendStylesheet?: (href: string) => HTMLLinkElement;
	readonly onError?: (cause: unknown) => void;
}

function googleCssUrl(family: string, weights = '400;600'): string {
	const queryFamily = family.trim().replace(/\s+/g, '+');
	return `https://fonts.googleapis.com/css2?family=${queryFamily}` +
		(weights ? `:wght@${weights}` : '') + '&display=swap';
}

function googleEntry(
	id: string,
	label: string,
	scripts: readonly ReaderFontCatalogScript[],
	weights = '400;600',
): ReaderFontCatalogEntry {
	const presentation = readerLocalFontPresentation(label);
	return Object.freeze({
		id: `google:${id}`,
		source: 'google',
		label,
		family: label,
		fontFamilyCss: presentation.fontFamilyCss,
		searchText: `${presentation.searchText} Google Fonts`,
		scripts: Object.freeze([...scripts]),
		googleCssUrl: googleCssUrl(label, weights),
	});
}

/** 小而稳定的精选集；完整目录不进入 UI，避免为浏览字体预发数百个请求。 */
export const READER_CURATED_GOOGLE_FONTS = Object.freeze([
	googleEntry('noto-sans-sc', 'Noto Sans SC', ['cjk', 'latin']),
	googleEntry('noto-serif-sc', 'Noto Serif SC', ['cjk', 'latin']),
	googleEntry('ma-shan-zheng', 'Ma Shan Zheng', ['cjk'], ''),
	googleEntry('zcool-xiaowei', 'ZCOOL XiaoWei', ['cjk'], ''),
	googleEntry(
		'zcool-qingke-huangyou',
		'ZCOOL QingKe HuangYou',
		['cjk'],
		'',
	),
	googleEntry('inter', 'Inter', ['latin']),
	googleEntry('jetbrains-mono', 'JetBrains Mono', ['latin', 'code']),
	googleEntry('source-code-pro', 'Source Code Pro', ['latin', 'code']),
	googleEntry('roboto-slab', 'Roboto Slab', ['latin']),
	googleEntry('merriweather', 'Merriweather', ['latin']),
	googleEntry('playfair-display', 'Playfair Display', ['latin']),
] as const);

function importedEntry(record: ReaderImportedFontRecord): ReaderFontCatalogEntry {
	const presentation = readerLocalFontPresentation(record.family);
	return Object.freeze({
		id: record.id,
		source: 'imported',
		label: record.label,
		family: record.family,
		fontFamilyCss: presentation.fontFamilyCss,
		searchText: `${record.label} ${record.fileName} ${record.family}`,
		scripts: Object.freeze(['cjk', 'latin', 'code'] as const),
		fileName: record.fileName,
		size: record.size,
	});
}

function normalizedImportLabel(fileName: string): string {
	const label = String(fileName)
		.replace(/\.(?:woff2?|ttf|otf)$/i, '')
		.replace(/[_-]+/g, ' ')
		.replace(/[\u0000-\u001f\u007f"'`,;{}<>\\]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	return [...(label || '导入字体')].slice(0, 40).join('');
}

function importedFamily(id: string, label: string): string {
	const token = id.replace(/^imported:/, '').slice(0, 16);
	return [...`LDP Import ${token} ${label}`]
		.slice(0, 64)
		.join('');
}

function acceptedFontFile(file: File): boolean {
	return /\.(?:woff2?|ttf|otf)$/i.test(file.name) || [
		'font/woff2',
		'font/woff',
		'font/ttf',
		'font/otf',
		'application/font-woff',
		'application/x-font-ttf',
		'application/x-font-opentype',
	].includes(String(file.type).toLowerCase());
}

function defaultRandomId(document: Document): string {
	const cryptoPort = document.defaultView?.crypto;
	if (typeof cryptoPort?.randomUUID === 'function') {
		return cryptoPort.randomUUID();
	}
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** 设置面板、AI 总结与后续功能共用的字体目录和加载 owner。 */
export class ReaderFontCatalog implements ReaderFontCatalogPort {
	readonly queryLocalFonts?: () => Promise<readonly string[]>;
	readonly #document: Document;
	readonly #store: ReaderImportedFontStorePort;
	readonly #now: () => number;
	readonly #randomId: () => string;
	readonly #loadImportedFont: NonNullable<
		ReaderFontCatalogOptions['loadImportedFont']
	>;
	readonly #loadGoogleFont: NonNullable<
		ReaderFontCatalogOptions['loadGoogleFont']
	>;
	readonly #appendStylesheet: (href: string) => HTMLLinkElement;
	readonly #onError: (cause: unknown) => void;
	readonly #listeners = new Set<() => void>();
	readonly #entries = new Map<string, ReaderFontCatalogEntry>(
		READER_CURATED_GOOGLE_FONTS.map((entry) => [entry.id, entry]),
	);
	readonly #imports = new Map<string, ReaderImportedFontRecord>();
	readonly #loads = new Map<string, Promise<boolean>>();
	readonly #faces = new Map<string, ReaderLoadedFontFace>();
	readonly #googleLinks = new Map<string, HTMLLinkElement>();
	#importsLoaded = false;
	#importsPending: Promise<void> | null = null;
	#destroyed = false;

	constructor(options: ReaderFontCatalogOptions) {
		this.#document = options.document;
		if (options.queryLocalFonts) {
			this.queryLocalFonts = options.queryLocalFonts;
		}
		this.#store = options.importedStore ?? new BrowserReaderImportedFontStore({
			...(options.indexedDb === undefined
				? {}
				: { factory: options.indexedDb }),
		});
		this.#now = options.now ?? Date.now;
		this.#randomId = options.randomId ?? (() => defaultRandomId(this.#document));
		this.#loadImportedFont = options.loadImportedFont ??
			((record) => this.#loadImported(record));
		this.#loadGoogleFont = options.loadGoogleFont ??
			((entry) => this.#loadGoogle(entry));
		this.#appendStylesheet = options.appendStylesheet ?? ((href) => {
			const link = this.#document.createElement('link');
			link.rel = 'stylesheet';
			link.href = href;
			(this.#document.head ?? this.#document.documentElement).append(link);
			return link;
		});
		this.#onError = options.onError ?? (() => {});
	}

	async entries(): Promise<readonly ReaderFontCatalogEntry[]> {
		await this.#loadImports();
		return Object.freeze([...this.#entries.values()]);
	}

	entry(id: string): ReaderFontCatalogEntry | null {
		return this.#entries.get(String(id)) ?? null;
	}

	findByFamily(family: string): ReaderFontCatalogEntry | null {
		const normalized = String(family).trim();
		return [...this.#entries.values()].find(
			(entry) => entry.family === normalized,
		) ?? null;
	}

	async ensureLoaded(id: string): Promise<boolean> {
		const normalized = String(id);
		const entry = this.#entries.get(normalized);
		if (!entry || this.#destroyed) return false;
		let pending = this.#loads.get(normalized);
		if (!pending) {
			pending = (entry.source === 'google'
				? this.#loadGoogleFont(entry)
				: this.#loadImportedFont(this.#imports.get(normalized)!)
					.then((loaded) => {
						if (!loaded) return false;
						this.#faces.set(normalized, loaded);
						return true;
					}))
				.catch((cause: unknown) => {
					this.#onError(cause);
					return false;
				});
			this.#loads.set(normalized, pending);
			void pending.then((loaded) => {
				if (!loaded && this.#loads.get(normalized) === pending) {
					this.#loads.delete(normalized);
				}
			});
		}
		return pending;
	}

	async importFile(file: File): Promise<ReaderFontCatalogEntry> {
		if (!acceptedFontFile(file)) {
			throw new Error('仅支持 WOFF2、WOFF、TTF 和 OTF 字体文件');
		}
		if (file.size <= 0 || file.size > READER_IMPORTED_FONT_MAX_BYTES) {
			throw new Error('单个字体文件需小于 32 MB');
		}
		await this.#loadImports();
		const records = [...this.#imports.values()];
		if (records.length >= READER_IMPORTED_FONT_MAX_COUNT) {
			throw new Error(`最多可导入 ${READER_IMPORTED_FONT_MAX_COUNT} 个字体`);
		}
		const total = records.reduce((sum, record) => sum + record.size, 0);
		if (total + file.size > READER_IMPORTED_FONT_TOTAL_MAX_BYTES) {
			throw new Error('导入字体总大小不能超过 128 MB');
		}
		const id = `imported:${this.#randomId()}`;
		const label = normalizedImportLabel(file.name);
		const record = Object.freeze<ReaderImportedFontRecord>({
			id,
			label,
			family: importedFamily(id, label),
			fileName: file.name,
			mimeType: file.type || 'application/octet-stream',
			size: file.size,
			importedAt: this.#now(),
			blob: file,
		});
		const loaded = await this.#loadImportedFont(record);
		if (!loaded) throw new Error('字体文件无法解码');
		try {
			await this.#store.write(record);
		} catch (cause) {
			loaded.remove();
			throw cause;
		}
		this.#imports.set(id, record);
		const entry = importedEntry(record);
		this.#entries.set(id, entry);
		this.#faces.set(id, loaded);
		this.#loads.set(id, Promise.resolve(true));
		this.#emit();
		return entry;
	}

	async removeImported(id: string): Promise<boolean> {
		const normalized = String(id);
		const entry = this.#entries.get(normalized);
		if (entry?.source !== 'imported') return false;
		await this.#store.remove(normalized);
		this.#faces.get(normalized)?.remove();
		this.#faces.delete(normalized);
		this.#imports.delete(normalized);
		this.#entries.delete(normalized);
		this.#loads.delete(normalized);
		this.#emit();
		return true;
	}

	subscribe(listener: () => void): Cleanup {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	async destroy(): Promise<void> {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#listeners.clear();
		for (const loaded of this.#faces.values()) loaded.remove();
		this.#faces.clear();
		for (const link of this.#googleLinks.values()) link.remove();
		this.#googleLinks.clear();
		await this.#store.close();
	}

	async #loadImports(): Promise<void> {
		if (this.#importsLoaded) return;
		if (this.#importsPending) return this.#importsPending;
		this.#importsPending = this.#store.list()
			.then((records) => {
				for (const record of records) {
					this.#imports.set(record.id, record);
					this.#entries.set(record.id, importedEntry(record));
				}
				this.#importsLoaded = true;
			})
			.catch((cause: unknown) => {
				this.#onError(cause);
			})
			.finally(() => {
				this.#importsPending = null;
			});
		return this.#importsPending;
	}

	async #loadImported(
		record: ReaderImportedFontRecord,
	): Promise<ReaderLoadedFontFace | null> {
		const view = this.#document.defaultView as
			| (Window & { FontFace?: typeof FontFace })
			| null;
		const Constructor = view?.FontFace ??
			(typeof FontFace === 'undefined' ? null : FontFace);
		const fontSet = this.#document.fonts;
		if (!Constructor || !fontSet || typeof fontSet.add !== 'function') {
			throw new Error('当前浏览器不支持动态字体加载');
		}
		const face = new Constructor(record.family, await record.blob.arrayBuffer());
		await face.load();
		fontSet.add(face);
		return Object.freeze({
			face,
			remove: () => fontSet.delete(face),
		});
	}

	async #loadGoogle(entry: ReaderFontCatalogEntry): Promise<boolean> {
		if (!entry.googleCssUrl) return false;
		const link = this.#appendStylesheet(entry.googleCssUrl);
		link.dataset.readerGoogleFont = entry.id;
		this.#googleLinks.set(entry.id, link);
		const loaded = new Promise<void>((resolve, reject) => {
			let settled = false;
			const finish = (cause?: unknown): void => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				if (cause === undefined) resolve();
				else reject(cause);
			};
			const timeout = setTimeout(
				() => finish(new Error(`Google 字体加载超时：${entry.label}`)),
				15_000,
			);
			link.addEventListener('load', () => finish(), { once: true });
			link.addEventListener('error', () => finish(
				new Error(`Google 字体样式加载失败：${entry.label}`),
			), { once: true });
			queueMicrotask(() => {
				if (link.sheet) finish();
			});
		});
		try {
			await loaded;
			const fontSet = this.#document.fonts;
			if (!fontSet || typeof fontSet.load !== 'function') return true;
			await fontSet.load(
				`400 16px ${JSON.stringify(entry.family)}`,
				READER_FONT_OPTION_PREVIEW,
			);
			return true;
		} catch (cause) {
			link.remove();
			this.#googleLinks.delete(entry.id);
			throw cause;
		}
	}

	#emit(): void {
		for (const listener of [...this.#listeners]) listener();
	}
}

export function readerFontCatalogValue(id: string): string {
	return `${READER_FONT_CATALOG_VALUE_PREFIX}${id}`;
}

export function readReaderFontCatalogValue(value: string): string | null {
	const normalized = String(value);
	return normalized.startsWith(READER_FONT_CATALOG_VALUE_PREFIX)
		? normalized.slice(READER_FONT_CATALOG_VALUE_PREFIX.length)
		: null;
}
