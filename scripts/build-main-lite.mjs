import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, version as esbuildVersion } from 'esbuild';

const SOURCE_PATH = 'lite/src/userscript/main-lite-entry.ts';
const BOOTSTRAP_PATH = 'lite/src/userscript/main-lite-bootstrap.ts';
const METADATA_PATH = 'lite/userscript.meta.txt';
const STYLESHEET_PATH = 'work/main-lite.css';
const DEBUG_OUTPUT_PATHS = ['work/main-lite.debug.js', 'work/mian-lite.debug.js'];
const LOCAL_DEBUG_OUTPUT_PATHS = ['work/main-lite.local.js', 'work/mian-lite.local.js'];
const LOCAL_DEBUG_LOADER_PATH = 'work/local-debug.user.js';
const STANDALONE_OUTPUT_PATH = 'work/main-lite.standalone.user.js';
const ADVISORY_OUTPUT_BYTES = 1_650_000;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const STYLE_RESOURCE_TOKEN = '__LDP_READER_STYLES_URL__';

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

async function inlineKatexStylesheet() {
	const root = path.join(projectRoot, 'node_modules/katex/dist');
	const css = await readFile(path.join(root, 'katex.min.css'), 'utf8');
	const pattern = /url\((fonts\/[^)]+)\)/g;
	const files = [...new Set([...css.matchAll(pattern)].map((match) => match[1]))];
	const fonts = await Promise.all(files.map(async (file) => {
		const bytes = await readFile(path.join(root, file));
		const format = path.extname(file).slice(1);
		if (!['woff2', 'woff', 'ttf'].includes(format)) {
			throw new Error(`KaTeX 字体格式不支持：${file}`);
		}
		return [file, `data:font/${format};base64,${bytes.toString('base64')}`];
	}));
	const resources = new Map(fonts);
	return {
		css: css.replace(pattern, (_match, file) => `url(${resources.get(file)})`),
		fonts: files.length,
	};
}

function versionedLocalFileUrl(filePath, digest) {
	if (!/^[0-9a-f]{64}$/.test(digest)) {
		throw new Error('本地资源 SHA-256 无效');
	}
	const url = new URL(browserFileUrl(filePath));
	url.searchParams.set('v', digest);
	return url.href;
}

function renderLocalDebugLoader(metadata, bundlePath, bundleDigest) {
	const inherited = metadata.split(/\r?\n/).filter((line) => {
		const match = line.match(/^\/\/\s+@(\S+)/);
		if (!match) return false;
		const key = match[1].toLowerCase();
		return !(
			key === 'name' ||
			key.startsWith('name:') ||
			key === 'description' ||
			key.startsWith('description:') ||
			key === 'version' ||
			key === 'downloadurl' ||
			key === 'installurl' ||
			key === 'updateurl'
		);
	});
	return [
		'// ==UserScript==',
		'// @name         Awesome LinuxDo Reader（本地调试）',
		`// @version      0.0.0-local.${bundleDigest.slice(0, 12)}`,
		'// @description  从本地内容指纹资源加载；重新构建后刷新页面生效',
		...inherited,
		'// @updateURL    none',
		'// @downloadURL  none',
		`// @require      ${versionedLocalFileUrl(bundlePath, bundleDigest)}`,
		'// ==/UserScript==',
		'',
	].join('\n');
}

function parseArgs(args) {
	if (args.length === 1 && args[0] === '--check') return { mode: 'check' };
	if (args.length === 1 && args[0] === '--debug') return { mode: 'debug' };
	if (args.length === 1 && args[0] === '--local-debug') {
		return { mode: 'local-debug' };
	}
	throw new Error('必须指定 --check、--debug 或 --local-debug；正式发布使用 Greasy Fork 四文件构建');
}

const options = Object.freeze({
	entryPoints: [path.join(projectRoot, SOURCE_PATH)],
	bundle: true,
	charset: 'utf8',
	format: 'iife',
	globalName: 'AwesomeLinuxDoReaderLite',
	legalComments: 'inline',
	minify: false,
	platform: 'browser',
	sourcemap: false,
	target: 'es2022',
	treeShaking: true,
	write: false,
});

const { mode } = parseArgs(process.argv.slice(2));
const rawMetadata = await readFile(
	path.join(projectRoot, METADATA_PATH),
	'utf8',
);
const bootstrap = await readFile(path.join(projectRoot, BOOTSTRAP_PATH), 'utf8');
const stylesheetFilePath = path.join(projectRoot, STYLESHEET_PATH);
const stylesheet = await readFile(stylesheetFilePath, 'utf8');
const stylesheetSha256 = sha256(stylesheet);
if (!rawMetadata.includes(STYLE_RESOURCE_TOKEN)) {
	throw new Error(
		`${METADATA_PATH} 必须通过 ${STYLE_RESOURCE_TOKEN} 声明 Lite CSS`,
	);
}
const readerStylesUrl = versionedLocalFileUrl(
	stylesheetFilePath,
	stylesheetSha256,
);
const metadata = rawMetadata.replace(STYLE_RESOURCE_TOKEN, readerStylesUrl);
if (/work\/main\.css(?:[?#\s]|$)/i.test(metadata)) {
	throw new Error(`${METADATA_PATH} 不得回退到 work/main.css`);
}
if (
	!metadata.startsWith('// ==UserScript==') ||
	!metadata.trimEnd().endsWith('// ==/UserScript==')
) {
	throw new Error(`${METADATA_PATH} 缺少完整 userscript 元数据块`);
}
for (const requiredKey of ['@name', '@description', '@namespace', '@version']) {
	if (!new RegExp(`^//\\s+${requiredKey}\\s+\\S`, 'm').test(metadata)) {
		throw new Error(`${METADATA_PATH} 缺少 ${requiredKey}`);
	}
}
if (!/^\/\/\s+@(match|include)\s+\S/m.test(metadata)) {
	throw new Error(`${METADATA_PATH} 至少需要一个 @match 或 @include`);
}
if (/^\/\/\s+@(updateURL|installURL|downloadURL)\s+\S/m.test(metadata)) {
	throw new Error(`${METADATA_PATH} 不得指定绕过 Greasy Fork 的更新地址`);
}
const katexScriptVersion = metadata.match(
	/^\/\/\s+@require\s+\S*\/katex@([^/]+)\/dist\/katex\.min\.js\s*$/m,
)?.[1];
const katexStyleVersion = metadata.match(
	/^\/\/\s+@resource\s+ldpKatexStyles\s+\S*\/katex@([^/]+)\/dist\/katex\.min\.css\s*$/m,
)?.[1];
const katexStyleUrl = metadata.match(
	/^\/\/\s+@resource\s+ldpKatexStyles\s+(\S+)\s*$/m,
)?.[1];
const runtimeKatexStyleUrl = bootstrap.match(
	/const KATEX_STYLESHEET_URL\s*=\s*['"]([^'"]+)['"]/,
)?.[1];
if (
	!katexScriptVersion ||
	!katexStyleVersion ||
	katexScriptVersion !== katexStyleVersion ||
	katexStyleUrl !== runtimeKatexStyleUrl
) {
	throw new Error(
		`${METADATA_PATH} 的 KaTeX JS/CSS 与 runtime stylesheet URL 必须存在且一致`,
	);
}

const result = await build(options);
if (result.warnings.length) {
	throw new Error(`esbuild 返回 ${result.warnings.length} 条警告`);
}
const outputFile = result.outputFiles?.[0];
if (!outputFile) throw new Error('esbuild 未返回 main-lite 构建产物');
const banner =
	'/* DEVELOPMENT ARCHITECTURE BUNDLE: compatibility gate 未完成，不接管现有 userscript。 */\n';
const artifact = `${metadata.trimEnd()}\n\n${banner}${outputFile.text}`;
const bytes = Buffer.byteLength(artifact);
const artifactSha256 = sha256(artifact);
let localDebugLoader = null;
let standaloneArtifact = null;
let standaloneFonts = 0;
let standaloneVendors = null;

if (mode === 'debug') {
	await Promise.all(DEBUG_OUTPUT_PATHS.map(async (outputPath) => {
		const outputFilePath = path.join(projectRoot, outputPath);
		await mkdir(path.dirname(outputFilePath), { recursive: true });
		await writeFile(outputFilePath, artifact);
	}));
} else if (mode === 'local-debug') {
	await Promise.all(LOCAL_DEBUG_OUTPUT_PATHS.map(async (outputPath) => {
		const outputFilePath = path.join(projectRoot, outputPath);
		await mkdir(path.dirname(outputFilePath), { recursive: true });
		await writeFile(outputFilePath, artifact);
	}));
	const loaderFilePath = path.join(projectRoot, LOCAL_DEBUG_LOADER_PATH);
	localDebugLoader = renderLocalDebugLoader(
		metadata,
		path.join(projectRoot, LOCAL_DEBUG_OUTPUT_PATHS[0]),
		artifactSha256,
	);
	await mkdir(path.dirname(loaderFilePath), { recursive: true });
	await writeFile(loaderFilePath, localDebugLoader);
	const packages = [
		['katex', katexScriptVersion],
		['pinyin-pro', metadata.match(/\/pinyin-pro@([^/]+)\//)?.[1]],
		['hls.js', metadata.match(/\/hls\.js@([^/]+)\//)?.[1]],
	];
	const licenses = await Promise.all(packages.map(async ([name, version]) => {
		const root = path.join(projectRoot, 'node_modules', name);
		const installed = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
		if (!version || installed.version !== version) {
			throw new Error(`本地 ${name} 版本与 userscript 元数据不一致`);
		}
		return `/*! ${name}@${version}\n${await readFile(path.join(root, 'LICENSE'), 'utf8')}\n*/`;
	}));
	const [standaloneResult, vendorResult, katexStyles] = await Promise.all([
		build({ ...options, entryPoints: [path.join(projectRoot, BOOTSTRAP_PATH)] }),
		build({
			...options,
			entryPoints: undefined,
			stdin: {
				contents: 'export { default as katex } from "katex";\n' +
					'export { default as Hls } from "hls.js";\n' +
					'import { pinyin } from "pinyin-pro";\nexport const pinyinPro = { pinyin };',
				resolveDir: projectRoot,
				sourcefile: 'main-lite-standalone-vendors.js',
			},
			globalName: 'AwesomeLinuxDoReaderVendors',
			minify: true,
		}),
		inlineKatexStylesheet(),
	]);
	const standaloneBundle = standaloneResult.outputFiles?.[0];
	const vendorBundle = vendorResult.outputFiles?.[0];
	if (standaloneResult.warnings.length || vendorResult.warnings.length ||
		!standaloneBundle || !vendorBundle) {
		throw new Error('本地合并版构建失败或存在警告');
	}
	standaloneFonts = katexStyles.fonts;
	standaloneVendors = Object.fromEntries(packages);
	const standaloneMetadata = rawMetadata
		.replace(/^\/\/\s+@name:[^\s]+\s+.*\r?\n/gm, '')
		.replace(/^\/\/\s+@name\s+.*$/m,
			'// @name         Awesome LinuxDo Reader（纯本地单文件版）')
		.replace(/^\/\/\s+@(require|resource|icon)\s+.*\r?\n/gm, '')
		.replace(/^\/\/\s+@grant\s+GM_getResourceText\s*\r?\n/gm, '')
		.replace('// ==/UserScript==',
			'// @updateURL    none\n// @downloadURL  none\n// ==/UserScript==');
	const grants = [...standaloneMetadata.matchAll(/^\/\/\s+@grant\s+(GM_\w+)/gm)]
		.map((match) => match[1]);
	const bindings = grants.map((name) =>
		`${name}: typeof ${name} === "function" ? (...args) => ${name}(...args) : undefined`);
	standaloneArtifact = `${standaloneMetadata.trimEnd()}\n\n` +
		licenses.join('\n') + '\n/* BEGIN LOCAL VENDORS */\n' + vendorBundle.text +
		'\n/* END LOCAL VENDORS */\n' +
		standaloneBundle.text +
		`\nvar __LDP_LOCAL_STYLES__ = ${JSON.stringify({ reader: stylesheet, katex: katexStyles.css })};\n` +
		'AwesomeLinuxDoReaderLite.startMainLiteUserscript(\n' +
		'  Object.assign({}, AwesomeLinuxDoReaderVendors, {\n' +
		'    window, unsafeWindow: typeof unsafeWindow === "undefined" ? window : unsafeWindow,\n' +
		'    GM: typeof GM === "undefined" ? undefined : GM,\n' +
		'    GM_info: typeof GM_info === "undefined" ? undefined : GM_info,\n' +
		`    ${bindings.join(',\n    ')}\n` +
		'  }), __LDP_LOCAL_STYLES__.reader, __LDP_LOCAL_STYLES__.katex);\n';
	await writeFile(path.join(projectRoot, STANDALONE_OUTPUT_PATH), standaloneArtifact);
}

const outputPaths =
	mode === 'debug'
		? DEBUG_OUTPUT_PATHS
		: LOCAL_DEBUG_OUTPUT_PATHS;
process.stdout.write(
	`${JSON.stringify({
		schemaVersion: 1,
		source: SOURCE_PATH,
		metadata: METADATA_PATH,
		output: outputPaths[0],
		compatibilityOutputs: outputPaths.slice(1),
		bytes,
		sha256: artifactSha256,
		advisoryBytes: ADVISORY_OUTPUT_BYTES,
		advisoryOverageBytes: Math.max(
			0,
			bytes - ADVISORY_OUTPUT_BYTES,
		),
		mode,
		styles: {
			resource: readerStylesUrl,
			sha256: stylesheetSha256,
		},
		localLoader: localDebugLoader === null
			? null
			: {
				file: LOCAL_DEBUG_LOADER_PATH,
				bytes: Buffer.byteLength(localDebugLoader),
				sha256: sha256(localDebugLoader),
			},
		standalone: standaloneArtifact === null ? null : {
			file: STANDALONE_OUTPUT_PATH,
			bytes: Buffer.byteLength(standaloneArtifact),
			sha256: sha256(standaloneArtifact),
			inlineStylesSha256: stylesheetSha256,
			fonts: standaloneFonts,
			vendors: standaloneVendors,
		},
		compiler: { name: 'esbuild', version: esbuildVersion },
	})}\n`,
);
