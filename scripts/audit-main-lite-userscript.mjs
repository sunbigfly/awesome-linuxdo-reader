import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Script } from 'node:vm';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const METADATA_PATH = 'lite/userscript.meta.txt';
const PACKAGE_PATH = 'package.json';
const BUILTIN_SITES_PATH = 'lite/src/site/reader-custom-site-repository.ts';
const LOADER_PATH = 'work/local-debug.user.js';
const LOCAL_BUNDLE_PATH = 'work/main-lite.local.js';
const STANDALONE_PATH = 'work/main-lite.standalone.user.js';
const LEGACY_LOCAL_BUNDLE_PATH = 'work/mian-lite.local.js';
const LOCAL_STYLESHEET_PATH = 'work/main-lite.css';
const LEGACY_LOCAL_STYLESHEET_PATH = 'work/mian-lite.css';
const LOCAL_FOUR_PART_LOADER_PATH =
	'work/main-lite.greasyfork.local.user.js';
const LOCAL_FOUR_PART_LIBRARY_PATHS = [
	'work/greasyfork-lite/libraries/main-lite-core.js',
	'work/greasyfork-lite/libraries/main-lite-platform.js',
	'work/greasyfork-lite/libraries/main-lite-features.js',
];
const STYLE_RESOURCE_TOKEN = '__LDP_READER_STYLES_URL__';
const KATEX_STYLESHEET =
	'https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css';
const LOCAL_NAME = 'Awesome LinuxDo Reader（本地调试）';
const LOCAL_VERSION_PREFIX = '0.0.0-local';
const LOCAL_DESCRIPTION = '从本地内容指纹资源加载；重新构建后刷新页面生效';

function parseArgs(args) {
	if (args.length === 0) return { localArtifact: false };
	if (args.length === 1 && args[0] === '--local-artifact') {
		return { localArtifact: true };
	}
	throw new Error('仅支持可选参数：--local-artifact');
}

function browserFileUrl(filePath) {
	const normalized = filePath.replaceAll('\\', '/');
	const windowsMount = normalized.match(/^\/mnt\/([a-z])\/(.+)$/i);
	if (!windowsMount) return pathToFileURL(filePath).href;
	const [, drive, relativePath] = windowsMount;
	return `file:///${drive.toUpperCase()}:/` +
		relativePath.split('/').map(encodeURIComponent).join('/');
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

function versionedLocalFileUrl(filePath, digest) {
	const url = new URL(browserFileUrl(filePath));
	url.searchParams.set('v', digest);
	return url.href;
}

function metadataBlock(source, sourcePath) {
	const opening = '// ==UserScript==';
	const closing = '// ==/UserScript==';
	const start = source.indexOf(opening);
	const end = source.indexOf(closing, start + opening.length);
	if (start < 0 || end < 0) {
		throw new Error(`${sourcePath} 缺少完整 userscript 元数据块`);
	}
	return source.slice(start, end + closing.length);
}

function metadataEntries(source, sourcePath) {
	const entries = new Map();
	for (const line of metadataBlock(source, sourcePath).split(/\r?\n/)) {
		const match = line.match(/^\/\/\s+@(\S+)\s+(.+?)\s*$/);
		if (!match) continue;
		const [, key, value] = match;
		const values = entries.get(key) ?? [];
		values.push(value);
		entries.set(key, values);
	}
	return entries;
}

function values(entries, key) {
	return entries.get(key) ?? [];
}

function normalizeWindowsFileUrlCase(value) {
	return value.replace(
		/file:\/\/\/[a-z]:\/[^\s]+/gi,
		(fileUrl) => fileUrl.toLowerCase(),
	);
}

function sameValues(
	actual,
	expected,
	{ windowsFileUrlCaseInsensitive = false } = {},
) {
	const normalize = windowsFileUrlCaseInsensitive
		? normalizeWindowsFileUrlCase
		: (value) => value;
	return actual.length === expected.length &&
		actual.every((value, index) =>
			normalize(value) === normalize(expected[index]));
}

function assertValues(entries, key, expected, sourcePath, options) {
	const actual = values(entries, key);
	if (!sameValues(actual, expected, options)) {
		throw new Error(
			`${sourcePath} 的 @${key} 漂移：` +
			`expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`,
		);
	}
}

function sortedKeys(entries, omitted = new Set()) {
	return [...entries.keys()].filter((key) => !omitted.has(key)).sort();
}

const { localArtifact } = parseArgs(process.argv.slice(2));
const [metadataSource, loaderSource, packageSource, builtinSitesSource,
	localBundleSource, localStylesheetSource] = await Promise.all([
		readFile(path.join(projectRoot, METADATA_PATH), 'utf8'),
		readFile(path.join(projectRoot, LOADER_PATH), 'utf8'),
		readFile(path.join(projectRoot, PACKAGE_PATH), 'utf8'),
		readFile(path.join(projectRoot, BUILTIN_SITES_PATH), 'utf8'),
		readFile(path.join(projectRoot, LOCAL_BUNDLE_PATH), 'utf8'),
		readFile(path.join(projectRoot, LOCAL_STYLESHEET_PATH), 'utf8'),
	]);
const metadata = metadataEntries(metadataSource, METADATA_PATH);
const loader = metadataEntries(loaderSource, LOADER_PATH);
const packageVersion = String(JSON.parse(packageSource).version ?? '');

const requiredMetadataKeys = new Set([
	'name',
	'name:zh-CN',
	'namespace',
	'version',
	'license',
	'description',
	'description:en',
	'author',
	'homepageURL',
	'supportURL',
	'match',
	'icon',
	'grant',
	'connect',
	'run-at',
	'resource',
	'require',
]);
const metadataKeys = new Set(sortedKeys(metadata));
const missingMetadataKeys = [...requiredMetadataKeys]
	.filter((key) => !metadataKeys.has(key));
if (missingMetadataKeys.length) {
	throw new Error(
		`${METADATA_PATH} 缺少字段：${missingMetadataKeys.join(', ')}`,
	);
}
for (const forbidden of ['updateURL', 'installURL', 'downloadURL']) {
	if (metadataKeys.has(forbidden)) {
		throw new Error(`${METADATA_PATH} 不得声明 @${forbidden}`);
	}
}
assertValues(metadata, 'version', [packageVersion], METADATA_PATH);
const builtinSitesBlock = builtinSitesSource.match(
	/READER_BUILTIN_DISCOURSE_HOSTS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\);/,
)?.[1];
if (!builtinSitesBlock) {
	throw new Error(`${BUILTIN_SITES_PATH} 缺少内置 Discourse host 列表`);
}
const builtinMatches = [...builtinSitesBlock.matchAll(/'([^']+)'/g)]
	.map(([, host]) => `https://${host}/*`);
assertValues(metadata, 'match', builtinMatches, METADATA_PATH);
assertValues(metadata, 'resource', [
	`ldpReaderStyles ${STYLE_RESOURCE_TOKEN}`,
	`ldpKatexStyles ${KATEX_STYLESHEET}`,
], METADATA_PATH);

const loaderInheritedKeys = [
	'namespace',
	'license',
	'author',
	'homepageURL',
	'supportURL',
	'match',
	'icon',
	'grant',
	'connect',
	'run-at',
];
for (const key of loaderInheritedKeys) {
	assertValues(loader, key, values(metadata, key), LOADER_PATH);
}
assertValues(loader, 'name', [LOCAL_NAME], LOADER_PATH);
const localBundleSha256 = sha256(localBundleSource);
const localStylesheetSha256 = sha256(localStylesheetSource);
let standaloneSha256 = null;
assertValues(loader, 'version', [
	`${LOCAL_VERSION_PREFIX}.${localBundleSha256.slice(0, 12)}`,
], LOADER_PATH);
assertValues(loader, 'description', [LOCAL_DESCRIPTION], LOADER_PATH);

const localStylesheetUrl = versionedLocalFileUrl(
	path.join(projectRoot, LOCAL_STYLESHEET_PATH),
	localStylesheetSha256,
);
const localBundleUrl = versionedLocalFileUrl(
	path.join(projectRoot, LOCAL_BUNDLE_PATH),
	localBundleSha256,
);
assertValues(loader, 'resource', [
	`ldpReaderStyles ${localStylesheetUrl}`,
	`ldpKatexStyles ${KATEX_STYLESHEET}`,
], LOADER_PATH, { windowsFileUrlCaseInsensitive: true });
assertValues(loader, 'require', [
	...values(metadata, 'require'),
	localBundleUrl,
], LOADER_PATH, { windowsFileUrlCaseInsensitive: true });
assertValues(loader, 'updateURL', ['none'], LOADER_PATH);
assertValues(loader, 'downloadURL', ['none'], LOADER_PATH);

if (localArtifact) {
	const [legacyLocalBundleSource,
		legacyLocalStylesheetSource] = await Promise.all([
		readFile(path.join(projectRoot, LEGACY_LOCAL_BUNDLE_PATH), 'utf8'),
		readFile(path.join(projectRoot, LEGACY_LOCAL_STYLESHEET_PATH), 'utf8'),
	]);
	if (localBundleSource !== legacyLocalBundleSource) {
		throw new Error('main-lite 与 mian-lite 本地 Bundle 兼容副本不一致');
	}
	if (localStylesheetSource !== legacyLocalStylesheetSource) {
		throw new Error('main-lite 与 mian-lite CSS 兼容副本不一致');
	}
	const localBundle = metadataEntries(localBundleSource, LOCAL_BUNDLE_PATH);
	for (const key of metadata.keys()) {
		if (key === 'resource') continue;
		assertValues(localBundle, key, values(metadata, key), LOCAL_BUNDLE_PATH);
	}
	assertValues(localBundle, 'resource', [
		`ldpReaderStyles ${localStylesheetUrl}`,
		`ldpKatexStyles ${KATEX_STYLESHEET}`,
	], LOCAL_BUNDLE_PATH);

	const standaloneSource = await readFile(path.join(projectRoot, STANDALONE_PATH), 'utf8');
	new Script(standaloneSource, { filename: STANDALONE_PATH });
	const standalone = metadataEntries(standaloneSource, STANDALONE_PATH);
	for (const key of metadata.keys()) {
		if (['name', 'resource', 'require', 'grant', 'icon'].includes(key) || key.startsWith('name:')) continue;
		assertValues(standalone, key, values(metadata, key), STANDALONE_PATH);
	}
	assertValues(standalone, 'name', ['Awesome LinuxDo Reader（纯本地单文件版）'], STANDALONE_PATH);
	for (const key of ['require', 'resource', 'icon']) {
		assertValues(standalone, key, [], STANDALONE_PATH);
	}
	assertValues(standalone, 'grant', values(metadata, 'grant').filter(
		(value) => value !== 'GM_getResourceText',
	), STANDALONE_PATH);
	assertValues(standalone, 'updateURL', ['none'], STANDALONE_PATH);
	assertValues(standalone, 'downloadURL', ['none'], STANDALONE_PATH);
	const stylesMarker = '\nvar __LDP_LOCAL_STYLES__ = ';
	const stylesOffset = standaloneSource.lastIndexOf(stylesMarker);
	const stylesEnd = standaloneSource.indexOf(';\n', stylesOffset);
	if (stylesOffset < 0 || stylesEnd < 0) {
		throw new Error('纯本地版缺少内置样式');
	}
	const inlineStyles = JSON.parse(standaloneSource.slice(
		stylesOffset + stylesMarker.length, stylesEnd,
	));
	if (inlineStyles.reader !== localStylesheetSource) {
		throw new Error('纯本地版内置 CSS 与当前样式产物不一致');
	}
	const katexRoot = path.join(projectRoot, 'node_modules/katex/dist');
	const katexCss = await readFile(path.join(katexRoot, 'katex.min.css'), 'utf8');
	const fontPattern = /url\((fonts\/[^)]+)\)/g;
	const fontFiles = [...new Set([...katexCss.matchAll(fontPattern)].map((match) => match[1]))];
	const fontData = new Map(await Promise.all(fontFiles.map(async (file) => [
		file,
		`data:font/${path.extname(file).slice(1)};base64,` +
			(await readFile(path.join(katexRoot, file))).toString('base64'),
	])));
	if (!fontFiles.length || inlineStyles.katex !== katexCss.replace(
		fontPattern, (_match, file) => `url(${fontData.get(file)})`,
	)) {
		throw new Error('纯本地版 KaTeX 样式或字体内容不完整');
	}
	if ([...(inlineStyles.reader + inlineStyles.katex).matchAll(/url\(\s*['"]?([^)'"\s]+)/gi)]
		.some((match) => !/^(data:|#)/i.test(match[1]))) {
		throw new Error('纯本地版样式仍包含外部资源');
	}
	const vendorStartMarker = '/* BEGIN LOCAL VENDORS */\n';
	const vendorStart = standaloneSource.indexOf(vendorStartMarker);
	const vendorEnd = standaloneSource.indexOf('/* END LOCAL VENDORS */', vendorStart);
	if (vendorStart < 0 || vendorEnd < vendorStart) throw new Error('纯本地版缺少内置依赖');
	let captured = null;
	let startupCalls = 0;
	const page = {};
	// Window.window 是只读访问器；普通 VM 全局对象不会准确复现该继承行为。
	const scriptGlobal = Object.defineProperty({}, 'window', { get: () => page });
	const lexicalRead = (key) => `lexical:${key}`;
	const smoke = new Script(
		'(function (GM_getValue, unsafeWindow, globalThis) {\n' +
		standaloneSource.slice(vendorStart + vendorStartMarker.length, vendorEnd) +
		standaloneSource.slice(stylesOffset) +
		'\n})(__readValue, __page, __global);',
	);
	smoke.runInNewContext({
		window: page,
		__readValue: lexicalRead,
		__page: page,
		__global: scriptGlobal,
		AwesomeLinuxDoReaderLite: {
			startMainLiteUserscript(environment, readerStyles, mathStyles) {
				startupCalls += 1;
				captured = { environment, readerStyles, mathStyles };
			},
		},
	}, { timeout: 10_000 });
	if (startupCalls !== 1 || captured?.readerStyles !== inlineStyles.reader ||
		captured.mathStyles !== inlineStyles.katex || captured.environment.unsafeWindow !== page ||
		captured.environment.GM_getValue('probe') !== lexicalRead('probe')) {
		throw new Error('纯本地版启动未正确传递内置资源或词法 GM API');
	}
	const vendors = captured.environment;
	const required = values(metadata, 'require').join('\n');
	if (vendors.katex?.version !== required.match(/\/katex@([^/]+)\//)?.[1] ||
		vendors.Hls?.version !== required.match(/\/hls\.js@([^/]+)\//)?.[1] ||
		!vendors.katex.renderToString('x^2').includes('katex') ||
		vendors.pinyinPro?.pinyin('中文', { toneType: 'none' }) !== 'zhong wen') {
		throw new Error('纯本地版第三方依赖版本或执行结果异常');
	}
	standaloneSha256 = sha256(standaloneSource);

	const [fourPartLoaderSource, ...fourPartLibrarySources] =
		await Promise.all([
			readFile(
				path.join(projectRoot, LOCAL_FOUR_PART_LOADER_PATH),
				'utf8',
			),
			...LOCAL_FOUR_PART_LIBRARY_PATHS.map((libraryPath) =>
				readFile(path.join(projectRoot, libraryPath), 'utf8')),
		]);
	const fourPartLoader = metadataEntries(
		fourPartLoaderSource,
		LOCAL_FOUR_PART_LOADER_PATH,
	);
	const fourPartVersion = values(fourPartLoader, 'version')[0] ?? '';
	const versionlessFourPartLoader = fourPartLoaderSource.replace(
		fourPartVersion,
		'__LDP_LOCAL_FOUR_PART_VERSION__',
	);
	assertValues(fourPartLoader, 'version', [
		`${packageVersion}-local-four-part.${sha256(versionlessFourPartLoader).slice(0, 12)}`,
	], LOCAL_FOUR_PART_LOADER_PATH);
	assertValues(fourPartLoader, 'resource', [
		`ldpReaderStyles ${localStylesheetUrl}`,
		`ldpKatexStyles ${KATEX_STYLESHEET}`,
	], LOCAL_FOUR_PART_LOADER_PATH, {
		windowsFileUrlCaseInsensitive: true,
	});
	assertValues(fourPartLoader, 'require', [
		...values(metadata, 'require'),
		...LOCAL_FOUR_PART_LIBRARY_PATHS.map((libraryPath, index) =>
			versionedLocalFileUrl(
				path.join(projectRoot, libraryPath),
				sha256(fourPartLibrarySources[index] ?? ''),
			)),
	], LOCAL_FOUR_PART_LOADER_PATH, {
		windowsFileUrlCaseInsensitive: true,
	});
	assertValues(
		fourPartLoader,
		'updateURL',
		['none'],
		LOCAL_FOUR_PART_LOADER_PATH,
	);
	assertValues(
		fourPartLoader,
		'downloadURL',
		['none'],
		LOCAL_FOUR_PART_LOADER_PATH,
	);
}

const expectedLoaderKeys = new Set([
	'name',
	'version',
	'description',
	...loaderInheritedKeys,
	'resource',
	'require',
	'updateURL',
	'downloadURL',
]);
const extraLoaderKeys = [...loader.keys()]
	.filter((key) => !expectedLoaderKeys.has(key));
if (extraLoaderKeys.length) {
	throw new Error(
		`${LOADER_PATH} 存在未登记元数据字段：${extraLoaderKeys.join(', ')}`,
	);
}

process.stdout.write(`${JSON.stringify({
	schemaVersion: 4,
	baseline: METADATA_PATH,
	metadata: METADATA_PATH,
	packageVersion,
	loader: LOADER_PATH,
	localBundle: localArtifact ? LOCAL_BUNDLE_PATH : null,
	standalone: localArtifact ? STANDALONE_PATH : null,
	standaloneSha256,
	localFourPartLoader: localArtifact ? LOCAL_FOUR_PART_LOADER_PATH : null,
	localBundleSha256,
	localStylesheetSha256,
	matches: values(metadata, 'match').length,
	grants: values(metadata, 'grant'),
	connects: values(metadata, 'connect'),
	requires: values(metadata, 'require'),
	resources: values(metadata, 'resource').map((entry) => entry.split(/\s+/, 1)[0]),
})}\n`);
