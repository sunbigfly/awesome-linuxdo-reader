#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');

const ROOT = __dirname;
const TEMPLATE_PATH = path.join(ROOT, 'main-loader.template.user.js');
const DEFAULT_CONFIG_PATH = path.join(ROOT, 'release.config.json');
const OUTPUT_DIR = path.join(ROOT, 'release');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'main.user.js');
const MARKER = '// __LDP_LIBRARY_REQUIREMENTS__';
const PROJECT_EXECUTABLE_CEILING = 2_000_000;

function sha256(value) {
	return crypto.createHash('sha256').update(value).digest('hex');
}

function requireValue(flag) {
	const index = process.argv.indexOf(flag);
	return index >= 0 ? process.argv[index + 1] : '';
}

function validateLibraryUrl(value) {
	const url = new URL(value);
	if (url.protocol !== 'https:') throw new Error('Library URL 必须使用 HTTPS');
	if (!['greasyfork.org', 'update.greasyfork.org'].includes(url.hostname)) {
		throw new Error(`Library 必须托管在 Greasy Fork：${url.hostname}`);
	}
	if (/替换为|__/.test(value)) throw new Error('release config 仍包含占位符');
	return url.href;
}

const configArgument = requireValue('--config');
const configPath = path.resolve(ROOT, configArgument || path.basename(DEFAULT_CONFIG_PATH));
if (!fs.existsSync(configPath)) {
	throw new Error(`缺少发布配置：${configPath}\n请先复制 release.config.example.json 为 release.config.json 并填写已发布 Library URL。`);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
if (config.schemaVersion !== 1 || !Array.isArray(config.libraries) || !config.libraries.length) {
	throw new Error('发布配置至少需要一个 Library');
}
const names = new Set();
const requirements = config.libraries.map((library) => {
	if (!library?.name || names.has(library.name)) throw new Error(`Library 名称为空或重复：${library?.name || ''}`);
	names.add(library.name);
	const localPath = path.resolve(ROOT, library.file || '');
	if (!localPath.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(localPath)) {
		throw new Error(`Library 本地文件无效：${library.file || ''}`);
	}
	const code = fs.readFileSync(localPath);
	if (code.byteLength > PROJECT_EXECUTABLE_CEILING) {
		throw new Error(`${library.name} 超过项目执行文件闸门：${code.byteLength}`);
	}
	const url = validateLibraryUrl(library.url);
	return `// @require      ${url}#sha256=${sha256(code)}`;
});
const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
if (template.split(MARKER).length !== 2) throw new Error('主脚本模板中的 Library 标记数量不为 1');
const output = template.replace(MARKER, requirements.join('\n'));
parser.parse(output, { sourceType: 'script' });
if (Buffer.byteLength(output) > PROJECT_EXECUTABLE_CEILING) {
	throw new Error(`发布主脚本超过项目执行文件闸门：${Buffer.byteLength(output)}`);
}
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(OUTPUT_PATH, output, 'utf8');
console.log(JSON.stringify({
	output: path.relative(ROOT, OUTPUT_PATH),
	bytes: Buffer.byteLength(output),
	sha256: sha256(output),
	libraries: config.libraries.map((library, index) => ({
		name: library.name,
		file: library.file,
		require: requirements[index],
	})),
}, null, 2));
