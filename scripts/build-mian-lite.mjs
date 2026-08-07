import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, version as esbuildVersion } from 'esbuild';

const SOURCE_PATH = 'lite/src/userscript/mian-lite-entry.ts';
const BOOTSTRAP_PATH = 'lite/src/userscript/mian-lite-bootstrap.ts';
const METADATA_PATH = 'lite/userscript.meta.txt';
const RELEASE_GATE_PATH = 'lite/release-gate.json';
const STYLESHEET_PATH = 'work/mian-lite.css';
const OUTPUT_PATH = 'work/mian-lite.js';
const DEBUG_OUTPUT_PATH = 'work/mian-lite.debug.js';
const LOCAL_DEBUG_OUTPUT_PATH = 'work/mian-lite.local.js';
const ADVISORY_OUTPUT_BYTES = 1_650_000;
const REQUIRED_RELEASE_ACCEPTANCE = [
	'runtimeComplete',
	'featureContractCoverageComplete',
	'browserMatrixAccepted',
	'performanceAccepted',
	'rollbackVerified',
];
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

function releaseStylesUrl(releaseGate, stylesheetSha256) {
	const value = String(releaseGate.readerStylesUrl ?? '').trim();
	const match = value.match(
		/^https:\/\/cdn\.jsdelivr\.net\/gh\/sunbigfly\/awesome-linuxdo-reader@([0-9a-f]{40})\/work\/mian-lite\.css#sha256=([0-9a-f]{64})$/i,
	);
	if (!match) {
		throw new Error(
			`${RELEASE_GATE_PATH}.readerStylesUrl 必须是带 commit 与 sha256 的 ` +
			'不可变 work/mian-lite.css jsDelivr URL',
		);
	}
	if (match[2].toLowerCase() !== stylesheetSha256) {
		throw new Error(
			`${RELEASE_GATE_PATH}.readerStylesUrl 的 sha256 与当前 ` +
			`${STYLESHEET_PATH} 不一致`,
		);
	}
	return value;
}

function parseArgs(args) {
	if (args.length === 0) return { mode: 'release' };
	if (args.length === 1 && args[0] === '--check') return { mode: 'check' };
	if (args.length === 1 && args[0] === '--debug') return { mode: 'debug' };
	if (args.length === 1 && args[0] === '--local-debug') {
		return { mode: 'local-debug' };
	}
	throw new Error('仅支持可选参数：--check、--debug 或 --local-debug');
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
const stylesheetSha256 = createHash('sha256')
	.update(stylesheet)
	.digest('hex');
const releaseGate = mode === 'release'
	? JSON.parse(
		await readFile(path.join(projectRoot, RELEASE_GATE_PATH), 'utf8'),
	)
	: null;
if (releaseGate) {
	const blockedBy = REQUIRED_RELEASE_ACCEPTANCE.filter(
		(key) => releaseGate[key] !== true,
	);
	if (blockedBy.length) {
		throw new Error(
			`mian-lite 尚不可发布，release gate 未通过：${blockedBy.join(', ')}`,
		);
	}
}
if (!rawMetadata.includes(STYLE_RESOURCE_TOKEN)) {
	throw new Error(
		`${METADATA_PATH} 必须通过 ${STYLE_RESOURCE_TOKEN} 声明 Lite CSS`,
	);
}
const readerStylesUrl = mode === 'release'
	? releaseStylesUrl(releaseGate, stylesheetSha256)
	: browserFileUrl(stylesheetFilePath);
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
if (!outputFile) throw new Error('esbuild 未返回 mian-lite 构建产物');
const banner =
	'/* DEVELOPMENT ARCHITECTURE BUNDLE: compatibility gate 未完成，不接管现有 userscript。 */\n';
const artifact = `${metadata.trimEnd()}\n\n${banner}${outputFile.text}`;
const bytes = Buffer.byteLength(artifact);

if (mode === 'release') {
	const outputFilePath = path.join(projectRoot, OUTPUT_PATH);
	await mkdir(path.dirname(outputFilePath), { recursive: true });
	await writeFile(outputFilePath, artifact);
} else if (mode === 'debug') {
	const outputFilePath = path.join(projectRoot, DEBUG_OUTPUT_PATH);
	await mkdir(path.dirname(outputFilePath), { recursive: true });
	await writeFile(outputFilePath, artifact);
} else if (mode === 'local-debug') {
	const outputFilePath = path.join(projectRoot, LOCAL_DEBUG_OUTPUT_PATH);
	await mkdir(path.dirname(outputFilePath), { recursive: true });
	await writeFile(outputFilePath, artifact);
}

const outputPath =
	mode === 'debug'
		? DEBUG_OUTPUT_PATH
		: mode === 'local-debug'
			? LOCAL_DEBUG_OUTPUT_PATH
			: OUTPUT_PATH;
process.stdout.write(
	`${JSON.stringify({
		schemaVersion: 1,
		source: SOURCE_PATH,
		metadata: METADATA_PATH,
		output: outputPath,
		bytes,
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
		compiler: { name: 'esbuild', version: esbuildVersion },
	})}\n`,
);
