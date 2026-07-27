#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');

const ROOT = __dirname;
const SOURCE_PATH = path.join(ROOT, 'main.user.js');
const CORE_PATH = path.join(ROOT, 'reader-core.js');
const LOADER_TEMPLATE_PATH = path.join(ROOT, 'main-loader.template.user.js');
const BUILD_MANIFEST_PATH = path.join(ROOT, 'split-build.json');
const PROJECT_EXECUTABLE_CEILING = 2_000_000;
const GREASY_FORK_HARD_LIMIT = 2 * 1024 * 1024;

function sha256(value) {
	return crypto.createHash('sha256').update(value).digest('hex');
}

function parseVersion(metadata) {
	const match = metadata.match(/^\s*\/\/\s*@version\s+([^\s]+)\s*$/m);
	if (!match) throw new Error('userscript 元数据缺少 @version');
	return match[1];
}

function removeGreasyForkManagedUpdateUrls(metadata) {
	return metadata.replace(
		/^\/\/\s+@(?:downloadURL|updateURL)\s+.*(?:\r?\n|$)/gm,
		'',
	);
}

function insertLibraryRequirementMarker(metadata) {
	const endMarker = '// ==/UserScript==';
	const markerIndex = metadata.indexOf(endMarker);
	if (markerIndex < 0) throw new Error('userscript 元数据缺少结束标记');
	const requirement = [
		'// build-release.cjs 会在下一行按需插入已发布的 Greasy Fork Library。',
		'// __LDP_LIBRARY_REQUIREMENTS__',
		'',
	].join('\n');
	return `${metadata.slice(0, markerIndex)}${requirement}${metadata.slice(markerIndex)}`;
}

const source = fs.readFileSync(SOURCE_PATH, 'utf8');
const metadataMatch = source.match(/^\/\/ ==UserScript==[\s\S]*?^\/\/ ==\/UserScript==\s*(?:\r?\n)?/m);
if (!metadataMatch || metadataMatch.index !== 0) throw new Error('找不到文件开头的 userscript 元数据');
const metadata = metadataMatch[0];
const version = parseVersion(metadata);
const ast = parser.parse(source, { sourceType: 'script' });
if (ast.program.body.length !== 1) {
	throw new Error(`期望元数据后只有一个 IIFE，实际为 ${ast.program.body.length} 个顶层语句`);
}
const statement = ast.program.body[0];
const call = statement.type === 'ExpressionStatement' ? statement.expression : null;
if (
	call?.type !== 'CallExpression'
	|| !['FunctionExpression', 'ArrowFunctionExpression'].includes(call.callee.type)
) {
	throw new Error('元数据后的唯一顶层语句不是 IIFE');
}
const executable = source.slice(statement.start, statement.end);
const sourceHash = sha256(source);

const core = `// Awesome LinuxDo Reader Core Library
// Source version: ${version}
// Source SHA-256: ${sourceHash}
// License: MIT
(function (global) {
\t'use strict';

\tconst API_NAME = 'AwesomeLinuxDoReaderCore';
\tlet started = false;

\tfunction run() {
\t\tif (started) return false;
\t\tstarted = true;
${executable}
\t\treturn true;
\t}

\tif (Object.prototype.hasOwnProperty.call(global, API_NAME)) {
\t\tthrow new Error(\`[LDP] \${API_NAME} 已存在，拒绝覆盖\`);
\t}
\tObject.defineProperty(global, API_NAME, {
\t\tvalue: Object.freeze({
\t\t\tschemaVersion: 1,
\t\t\tsourceVersion: '${version}',
\t\t\tsourceSha256: '${sourceHash}',
\t\t\trun,
\t\t\tget started() { return started; },
\t\t}),
\t\tconfigurable: false,
\t\tenumerable: false,
\t\twritable: false,
\t});
})(globalThis);
`;

const loaderMetadata = insertLibraryRequirementMarker(
	removeGreasyForkManagedUpdateUrls(metadata),
);
const loader = `${loaderMetadata}
(function () {
\t'use strict';

\tconst core = globalThis.AwesomeLinuxDoReaderCore;
\tif (!core || core.schemaVersion !== 1 || core.sourceVersion !== '${version}') {
\t\tthrow new Error('[LDP] Reader Core 缺失或版本不匹配');
\t}
\tcore.run();
})();
`;

parser.parse(core, { sourceType: 'script' });
parser.parse(loader, { sourceType: 'script' });
fs.writeFileSync(CORE_PATH, core, 'utf8');
fs.writeFileSync(LOADER_TEMPLATE_PATH, loader, 'utf8');

const manifest = {
	schemaVersion: 1,
	sourceVersion: version,
	limits: {
		greasyForkHardLimit: GREASY_FORK_HARD_LIMIT,
		projectExecutableCeiling: PROJECT_EXECUTABLE_CEILING,
	},
	files: {
		'main.user.js': {
			role: 'standaloneSourceBaseline',
			bytes: Buffer.byteLength(source),
			sha256: sourceHash,
		},
		'reader-core.js': {
			role: 'greasyForkLibrary',
			bytes: Buffer.byteLength(core),
			sha256: sha256(core),
		},
		'main-loader.template.user.js': {
			role: 'greasyForkMainScriptTemplate',
			bytes: Buffer.byteLength(loader),
			sha256: sha256(loader),
		},
	},
};
for (const [name, data] of Object.entries(manifest.files)) {
	if (data.role !== 'standaloneSourceBaseline' && data.bytes > PROJECT_EXECUTABLE_CEILING) {
		throw new Error(`${name} 超过项目执行文件闸门：${data.bytes}`);
	}
}
fs.writeFileSync(BUILD_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(manifest, null, 2));
