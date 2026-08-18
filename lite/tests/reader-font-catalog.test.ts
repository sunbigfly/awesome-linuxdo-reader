import {
	READER_CURATED_GOOGLE_FONTS,
	ReaderFontCatalog,
	readReaderFontCatalogValue,
	readerFontCatalogValue,
} from '../src/font/reader-font-catalog.js';
import type {
	ReaderImportedFontRecord,
	ReaderImportedFontStorePort,
} from '../src/font/reader-imported-font-store.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class MemoryImportedFontStore implements ReaderImportedFontStorePort {
	readonly records = new Map<string, ReaderImportedFontRecord>();
	closed = false;

	list(): Promise<readonly ReaderImportedFontRecord[]> {
		return Promise.resolve(Object.freeze([...this.records.values()]));
	}

	read(id: string): Promise<ReaderImportedFontRecord | null> {
		return Promise.resolve(this.records.get(id) ?? null);
	}

	write(record: ReaderImportedFontRecord): Promise<void> {
		this.records.set(record.id, record);
		return Promise.resolve();
	}

	remove(id: string): Promise<void> {
		this.records.delete(id);
		return Promise.resolve();
	}

	close(): void {
		this.closed = true;
	}
}

function fontFile(name: string, type = 'font/woff2'): File {
	const blob = new Blob(['font-binary'], { type }) as File;
	Object.defineProperty(blob, 'name', { value: name });
	Object.defineProperty(blob, 'lastModified', { value: 1_760_000_000_000 });
	return blob;
}

const store = new MemoryImportedFontStore();
let googleLoads = 0;
let importedLoads = 0;
let removedFaces = 0;
let changes = 0;
const catalog = new ReaderFontCatalog({
	document: {} as Document,
	importedStore: store,
	randomId: () => 'font-test-id',
	now: () => 1_760_000_000_000,
	queryLocalFonts: async () => Object.freeze(['JetBrains Mono']),
	loadGoogleFont: async () => {
		googleLoads += 1;
		return true;
	},
	loadImportedFont: async () => {
		importedLoads += 1;
		return Object.freeze({
			face: {} as FontFace,
			remove: () => {
				removedFaces += 1;
			},
		});
	},
});
catalog.subscribe(() => {
	changes += 1;
});

const initial = await catalog.entries();
const jetBrains = initial.find((entry) => entry.id === 'google:jetbrains-mono');
assert(
	initial.length === READER_CURATED_GOOGLE_FONTS.length &&
	READER_CURATED_GOOGLE_FONTS.length === 11 &&
	jetBrains?.family === 'JetBrains Mono' &&
	initial.some((entry) =>
		entry.id === 'google:noto-sans-sc' && entry.scripts.includes('cjk')),
	'共享目录必须预置精选 Google Fonts，并包含 JetBrains Mono 与中文字体',
);
await catalog.ensureLoaded('google:jetbrains-mono');
await catalog.ensureLoaded('google:jetbrains-mono');
assert(googleLoads === 1, 'Google 字体在同一页面只能加载一次');

const imported = await catalog.importFile(fontFile('My_Test-Font.woff2'));
assert(
	imported.id === 'imported:font-test-id' &&
	imported.label === 'My Test Font' &&
	imported.family.includes('font-test-id') &&
	store.records.get(imported.id)?.blob.size === 11 &&
	importedLoads === 1 &&
	changes === 1 &&
	catalog.findByFamily(imported.family)?.id === imported.id &&
	readReaderFontCatalogValue(readerFontCatalogValue(imported.id)) === imported.id,
	'导入字体必须先验证解码，再持久化元数据与二进制文件',
);

const restoredCatalog = new ReaderFontCatalog({
	document: {} as Document,
	importedStore: store,
	loadGoogleFont: async () => true,
	loadImportedFont: async (record) => {
		assert(record.id === imported.id, '重开后必须按原 ID 读取导入字体');
		return Object.freeze({
			face: {} as FontFace,
			remove: () => {
				removedFaces += 1;
			},
		});
	},
});
assert(
	(await restoredCatalog.entries()).some((entry) => entry.id === imported.id) &&
	await restoredCatalog.ensureLoaded(imported.id),
	'重新打开页面后必须从 IndexedDB 目录恢复导入字体',
);
assert(
	await restoredCatalog.removeImported(imported.id) &&
	store.records.size === 0 &&
	removedFaces === 1,
	'删除导入字体必须同时删除持久化文件与已注册 FontFace',
);

let invalidRejected = false;
try {
	await catalog.importFile(fontFile('not-a-font.txt', 'text/plain'));
} catch {
	invalidRejected = true;
}
assert(invalidRejected, '导入必须拒绝非字体文件');
assert(
	(await catalog.queryLocalFonts?.())?.[0] === 'JetBrains Mono',
	'共享目录必须继续暴露浏览器本机字体查询',
);

await restoredCatalog.destroy();
await catalog.destroy();
assert(store.closed, '共享字体目录销毁时必须关闭持久化存储');
