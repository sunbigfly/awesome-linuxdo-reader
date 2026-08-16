import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const metadataPath = path.join(projectRoot, 'lite/userscript.meta.txt');
const stylesheetPath = path.join(projectRoot, 'work/main-lite.css');
const singleBundlePath = path.join(projectRoot, 'work/main-lite.local.js');
const singleCompatibilityPath = path.join(projectRoot, 'work/mian-lite.local.js');
const fourPartLoaderPath = path.join(
	projectRoot,
	'work/main-lite.greasyfork.local.user.js',
);
const manifestPath = path.join(
	projectRoot,
	'work/greasyfork-lite/build-manifest.json',
);
const contractPath = path.join(
	projectRoot,
	'lite/contracts/discourse-action-transports.json',
);
const sourceRoot = path.join(projectRoot, 'lite/src');
const libraryNames = [
	'main-lite-core',
	'main-lite-platform',
	'main-lite-features',
];
const ignoredIdentityKeys = new Set([
	'name',
	'name:zh-cn',
	'description',
	'description:en',
	'version',
	'updateurl',
	'downloadurl',
]);
const projectLibraryPattern = new RegExp(
	'/work/greasyfork-lite/libraries/' +
		'main-lite-(?:core|platform|features)\\.js(?:[?\\s]|$)',
	'i',
);
const registrationPattern =
	/\/\* Source: ([^\r\n]+) \*\/\r?\nruntime\.register\("([^"]+)",[\s\S]*?\r?\n\}, "([0-9a-f]{64})"\);/g;

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

function slash(value) {
	return value.replaceAll(path.sep, '/');
}

function metadataBlock(source, label) {
	const match = source.match(
		/^\/\/ ==UserScript==\r?\n[\s\S]*?^\/\/ ==\/UserScript==\s*$/m,
	);
	if (!match) throw new Error(`${label} 缺少完整 userscript 元数据块`);
	return match[0];
}

function directiveLines(source) {
	return metadataBlock(source, '产物').split(/\r?\n/).filter((line) => {
		const match = line.match(/^\/\/\s+@(\S+)\s*(.*)$/);
		if (!match) return false;
		const key = match[1].toLowerCase();
		if (ignoredIdentityKeys.has(key)) return false;
		return !(key === 'require' && projectLibraryPattern.test(match[2]));
	});
}

function directiveValue(source, key, label) {
	const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = metadataBlock(source, label).match(
		new RegExp(`^//\\s+@${escaped}\\s+(.+?)\\s*$`, 'mi'),
	);
	if (!match) throw new Error(`${label} 缺少 @${key}`);
	return match[1];
}

function metadataVersion(source, label) {
	return directiveValue(source, 'version', label);
}

function stylesheetResource(source, label) {
	const match = metadataBlock(source, label).match(
		/^\/\/\s+@resource\s+ldpReaderStyles\s+(.+?)\s*$/mi,
	);
	if (!match) throw new Error(`${label} 缺少 @resource ldpReaderStyles`);
	return match[1];
}

function localFileDigest(value, label) {
	const url = new URL(value);
	if (url.protocol !== 'file:') throw new Error(`${label} 不是 file:// 本地资源`);
	const digest = url.searchParams.get('v');
	if (!/^[0-9a-f]{64}$/.test(digest ?? '')) {
		throw new Error(`${label} 缺少有效内容指纹`);
	}
	return digest;
}

async function walk(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(entries.map(async (entry) => {
		const target = path.join(directory, entry.name);
		return entry.isDirectory() ? walk(target) : [target];
	}));
	return nested.flat();
}

function moduleIdForSource(file) {
	const relative = slash(path.relative(path.join(projectRoot, 'lite'), file));
	return relative.endsWith('.ts')
		? `${relative.slice(0, -3)}.js`
		: relative;
}

async function expectedSourceModules() {
	const files = (await walk(sourceRoot))
		.filter((file) => file.endsWith('.ts'))
		.filter((file) => !/\/userscript\/mian-lite-(?:bootstrap|entry)\.ts$/.test(
			slash(file),
		))
		.sort();
	files.push(contractPath);
	return new Map(await Promise.all(files.map(async (file) => [
		moduleIdForSource(file),
		Object.freeze({
			file: slash(path.relative(projectRoot, file)),
			sha256: sha256(await readFile(file)),
		}),
	])));
}

async function actualSplitModules(libraryPaths) {
	const modules = new Map();
	for (const libraryPath of libraryPaths) {
		const source = await readFile(libraryPath, 'utf8');
		for (const match of source.matchAll(registrationPattern)) {
			const [, sourceFile, id, digest] = match;
			if (modules.has(id)) throw new Error(`四文件模块重复：${id}`);
			modules.set(id, Object.freeze({ sourceFile, sha256: digest }));
		}
	}
	return modules;
}

async function verify() {
	const [
		metadata,
		stylesheet,
		singleBundle,
		singleCompatibility,
		fourPartLoader,
		manifest,
	] = await Promise.all([
		readFile(metadataPath, 'utf8'),
		readFile(stylesheetPath),
		readFile(singleBundlePath, 'utf8'),
		readFile(singleCompatibilityPath, 'utf8'),
		readFile(fourPartLoaderPath, 'utf8'),
		readFile(manifestPath, 'utf8').then(JSON.parse),
	]);
	const version = metadataVersion(metadata, 'Lite 元数据');
	if (metadataVersion(singleBundle, '单文件本地调试版') !== version) {
		throw new Error('单文件本地调试版版本与 Lite 元数据不一致');
	}
	if (!metadataVersion(fourPartLoader, '四文件本地 Loader').startsWith(
		`${version}-local-four-part.`,
	)) {
		throw new Error('四文件本地 Loader 版本没有绑定当前 Lite 版本');
	}
	if (singleBundle !== singleCompatibility) {
		throw new Error('main-lite.local.js 与 mian-lite.local.js 不一致');
	}
	if (
		JSON.stringify(directiveLines(singleBundle)) !==
		JSON.stringify(directiveLines(fourPartLoader))
	) {
		throw new Error('单文件与四文件本地版的站点、权限、依赖或资源元数据不一致');
	}
	if (/https:\/\/update\.greasyfork\.org\/scripts\//.test(fourPartLoader)) {
		throw new Error('四文件本地 Loader 引用了远端项目 Library');
	}
	const stylesheetDigest = sha256(stylesheet);
	for (const [label, source] of [
		['单文件 CSS', singleBundle],
		['四文件 CSS', fourPartLoader],
	]) {
		if (localFileDigest(stylesheetResource(source, label), label) !== stylesheetDigest) {
			throw new Error(`${label} 指纹与 work/main-lite.css 不一致`);
		}
	}
	if (manifest.sourceVersion !== version) {
		throw new Error('四文件 manifest 版本与 Lite 元数据不一致');
	}
	const libraries = libraryNames.map((name) => {
		const item = manifest.libraries?.find((candidate) => candidate.name === name);
		if (!item) throw new Error(`四文件 manifest 缺少 ${name}`);
		return item;
	});
	const libraryPaths = libraries.map((item) => path.join(projectRoot, item.file));
	for (const [index, item] of libraries.entries()) {
		const content = await readFile(libraryPaths[index]);
		if (content.byteLength !== item.bytes || sha256(content) !== item.sha256) {
			throw new Error(`${item.name} 与 manifest bytes/SHA-256 不一致`);
		}
		for (const compatibilityFile of item.compatibilityFiles ?? []) {
			const compatibility = await readFile(path.join(projectRoot, compatibilityFile));
			if (!content.equals(compatibility)) {
				throw new Error(`${item.name} 的 main/mian 兼容副本不一致`);
			}
		}
	}
	const [expectedModules, actualModules] = await Promise.all([
		expectedSourceModules(),
		actualSplitModules(libraryPaths),
	]);
	for (const [id, expected] of expectedModules) {
		const actual = actualModules.get(id);
		if (!actual) throw new Error(`四文件缺少源码模块：${id}`);
		if (actual.sourceFile !== expected.file || actual.sha256 !== expected.sha256) {
			throw new Error(`四文件源码模块不是当前快照：${id}`);
		}
	}
	const vendorModules = [...actualModules.keys()].filter((id) => id.startsWith('vendor/'));
	const unexpectedModules = [...actualModules.keys()].filter(
		(id) => !expectedModules.has(id) && !id.startsWith('vendor/'),
	);
	if (unexpectedModules.length) {
		throw new Error(`四文件包含未知模块：${unexpectedModules.join(', ')}`);
	}
	if (vendorModules.length !== 1 || vendorModules[0] !== 'vendor/xsai-generate-text.js') {
		throw new Error('四文件第三方模块集合与单文件构建契约不一致');
	}
	if (
		actualModules.size !== manifest.modules ||
		libraries.reduce((total, item) => total + item.modules, 0) !== manifest.modules
	) {
		throw new Error('四文件模块数量与 manifest 不一致');
	}
	process.stdout.write(`${JSON.stringify({
		ok: true,
		gate: 'main-lite-local-parity',
		version,
		comparison: Object.freeze([
			'metadata directives',
			'local CSS bytes and SHA-256',
			'all Lite source module SHA-256 values',
			'library manifest bytes and SHA-256 values',
			'main/mian compatibility bytes',
		]),
		modules: actualModules.size,
		libraries: libraries.map(({ name, bytes, sha256: digest }) => ({
			name,
			bytes,
			sha256: digest,
		})),
		styles: { bytes: stylesheet.byteLength, sha256: stylesheetDigest },
	}, null, 2)}\n`);
}

try {
	await verify();
} catch (error) {
	const name = error instanceof Error ? error.name : 'UnknownError';
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`main-lite local parity: failed: ${name}: ${message}\n`);
	process.exitCode = 1;
}
