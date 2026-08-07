import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const stylesRoot = path.join(projectRoot, 'lite/styles');
const manifestPath = path.join(stylesRoot, 'manifest.json');
const outputPath = path.join(projectRoot, 'work/mian-lite.css');
const checkOnly = process.argv.slice(2).includes('--check');

function assertBalancedCss(source, file) {
	let depth = 0;
	let quote = '';
	let comment = false;
	let escaped = false;
	for (let index = 0; index < source.length; index += 1) {
		const char = source[index];
		const next = source[index + 1];
		if (comment) {
			if (char === '*' && next === '/') {
				comment = false;
				index += 1;
			}
			continue;
		}
		if (quote) {
			if (escaped) escaped = false;
			else if (char === '\\') escaped = true;
			else if (char === quote) quote = '';
			continue;
		}
		if (char === '/' && next === '*') {
			comment = true;
			index += 1;
			continue;
		}
		if (char === '"' || char === '\'') {
			quote = char;
			continue;
		}
		if (char === '{') depth += 1;
		else if (char === '}') depth -= 1;
		if (depth < 0) throw new Error(`${file} 存在多余的 }`);
	}
	if (comment) throw new Error(`${file} 存在未闭合注释`);
	if (quote) throw new Error(`${file} 存在未闭合字符串`);
	if (depth !== 0) throw new Error(`${file} 花括号不平衡：${depth}`);
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (
	!Number.isInteger(manifest.schemaVersion) ||
	manifest.schemaVersion < 1 ||
	!Array.isArray(manifest.sources) ||
	manifest.sources.length === 0
) {
	throw new Error('lite/styles/manifest.json 缺少有效 schemaVersion 或 sources');
}

const sources = [];
for (const sourceName of manifest.sources) {
	if (
		typeof sourceName !== 'string' ||
		!sourceName.endsWith('.css') ||
		path.basename(sourceName) !== sourceName
	) {
		throw new Error(`非法 lite CSS 源文件：${String(sourceName)}`);
	}
	const sourcePath = path.join(stylesRoot, sourceName);
	const source = (await readFile(sourcePath, 'utf8')).replace(/\r\n?/g, '\n');
	if (/@import\b/i.test(source)) {
		throw new Error(`${sourceName} 不得使用 @import；lite CSS 必须确定性单产物`);
	}
	if (/main\.css/i.test(source)) {
		throw new Error(`${sourceName} 不得依赖或引用 main.css`);
	}
	assertBalancedCss(source, sourceName);
	sources.push(Object.freeze({ name: sourceName, source: source.trimEnd() }));
}

const body = sources
	.map(({ name, source }) => `/* source: ${name} */\n${source}`)
	.join('\n\n');
const digest = createHash('sha256').update(body).digest('hex');
const artifact = [
	'/* Awesome LinuxDo Reader Lite stylesheet.',
	' * Generated only from lite/styles/*.css; do not edit work/mian-lite.css.',
	` * source-sha256: ${digest}`,
	' */',
	'',
	body,
	'',
].join('\n');

if (checkOnly) {
	const current = await readFile(outputPath, 'utf8').catch(() => '');
	if (current !== artifact) {
		throw new Error('work/mian-lite.css 缺失或已过期，请运行 npm run mian-lite:css:build');
	}
} else {
	await writeFile(outputPath, artifact);
}

process.stdout.write(`${JSON.stringify({
	schemaVersion: manifest.schemaVersion,
	output: 'work/mian-lite.css',
	sources: sources.map(({ name }) => name),
	bytes: Buffer.byteLength(artifact),
	sha256: createHash('sha256').update(artifact).digest('hex'),
	mode: checkOnly ? 'check' : 'build',
})}\n`);
