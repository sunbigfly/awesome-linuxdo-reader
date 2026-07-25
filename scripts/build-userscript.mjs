import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform, version as esbuildVersion } from 'esbuild';

const SOURCE_PATH = 'work/main.js';
const ARTIFACT_NAME = 'awesome-linuxdo-reader.user.js';
const MANIFEST_NAME = 'awesome-linuxdo-reader.build.json';
const MAX_ARTIFACT_BYTES = 950_000;
const MAX_GZIP_BYTES = 400_000;
const MINIFY_OPTIONS = Object.freeze({
	charset: 'utf8',
	keepNames: false,
	legalComments: 'none',
	minify: true,
	sourcefile: SOURCE_PATH,
	target: 'es2022',
	treeShaking: false,
});

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');

function outputDirectory(args) {
	if (!args.length) return path.join(projectRoot, 'dist');
	if (args.length !== 2 || args[0] !== '--out-dir') {
		throw new Error('仅支持可选参数：--out-dir <目录>');
	}
	const value = args[1];
	if (!value || value.startsWith('--')) {
		throw new Error('--out-dir 必须指定目录');
	}
	return path.resolve(process.cwd(), value);
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

function splitUserscript(source) {
	const openMarker = '// ==UserScript==';
	const closeMarker = '// ==/UserScript==';
	if (!source.startsWith(openMarker)) {
		throw new Error(`源码必须以 ${openMarker} 开头`);
	}
	const closeIndex = source.indexOf(closeMarker);
	if (closeIndex < 0) throw new Error(`源码缺少 ${closeMarker}`);
	const metadataEnd = closeIndex + closeMarker.length;
	const metadata = source.slice(0, metadataEnd);
	const body = source.slice(metadataEnd).replace(/^[\r\n]+/, '');
	if (!body.trim()) throw new Error('userscript 业务源码为空');
	return { body, metadata };
}

const outDir = outputDirectory(process.argv.slice(2));
const sourceFile = path.join(projectRoot, SOURCE_PATH);
const source = await readFile(sourceFile, 'utf8');
const { body, metadata } = splitUserscript(source);
const transformed = await transform(body, MINIFY_OPTIONS);
if (transformed.warnings.length) {
	throw new Error(`esbuild 返回 ${transformed.warnings.length} 条警告`);
}

const artifact = `${metadata}\n${transformed.code}`;
const artifactBytes = Buffer.byteLength(artifact);
const gzipBytes = gzipSync(Buffer.from(artifact), { level: 9, mtime: 0 }).length;
if (artifactBytes > MAX_ARTIFACT_BYTES || gzipBytes > MAX_GZIP_BYTES) {
	throw new Error(
		`发布产物超过体积门槛：${artifactBytes}/${MAX_ARTIFACT_BYTES} 字节，` +
		`gzip ${gzipBytes}/${MAX_GZIP_BYTES} 字节`,
	);
}

const manifest = {
	schemaVersion: 1,
	source: {
		path: SOURCE_PATH,
		bytes: Buffer.byteLength(source),
		sha256: sha256(source),
	},
	metadata: {
		bytes: Buffer.byteLength(metadata),
		sha256: sha256(metadata),
	},
	artifact: {
		path: `dist/${ARTIFACT_NAME}`,
		bytes: artifactBytes,
		gzipBytes,
		sha256: sha256(artifact),
	},
	compiler: {
		name: 'esbuild',
		version: esbuildVersion,
		options: MINIFY_OPTIONS,
	},
	limits: {
		artifactBytes: MAX_ARTIFACT_BYTES,
		gzipBytes: MAX_GZIP_BYTES,
	},
};

await mkdir(outDir, { recursive: true });
await Promise.all([
	writeFile(path.join(outDir, ARTIFACT_NAME), artifact),
	writeFile(path.join(outDir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`),
]);
process.stdout.write(`${JSON.stringify(manifest)}\n`);
