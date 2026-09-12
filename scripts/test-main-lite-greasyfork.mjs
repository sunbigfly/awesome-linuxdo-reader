import { build, transform } from 'esbuild';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { runInThisContext, Script } from 'node:vm';
import { fileURLToPath } from 'node:url';

const runtimeKey = '__AWESOME_LINUXDO_READER_LITE_MODULE_RUNTIME__';
const expectedLibraries = [
	'main-lite-core',
	'main-lite-platform',
	'main-lite-features',
];
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const testsDirectory = path.join(projectRoot, 'lite/tests');
const sourceDirectory = path.join(projectRoot, 'lite/src');
const runPath = path.join(testsDirectory, 'run.ts');
const libraryPaths = [
	path.join(projectRoot, 'work/greasyfork-lite/libraries/main-lite-core.js'),
	path.join(projectRoot, 'work/greasyfork-lite/libraries/main-lite-platform.js'),
	path.join(projectRoot, 'work/greasyfork-lite/libraries/main-lite-features.js'),
];

function isSourcePath(candidate) {
	const relative = path.relative(sourceDirectory, candidate);
	return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function moduleIdForPath(candidate) {
	return `src/${path.relative(sourceDirectory, candidate).split(path.sep).join('/')}`;
}

function renderModuleBridge(moduleId, moduleExports) {
	if ((typeof moduleExports !== 'object' || moduleExports === null) &&
		typeof moduleExports !== 'function') {
		throw new Error(`${moduleId} 没有可导出的模块对象`);
	}
	const lines = [
		`const __splitModule = globalThis[${JSON.stringify(runtimeKey)}].start(` +
			`${JSON.stringify(moduleId)}, ${JSON.stringify(expectedLibraries)});`,
	];
	for (const [index, name] of Object.keys(moduleExports).entries()) {
		if (name === 'default') {
			lines.push('export default __splitModule.default;');
			continue;
		}
		if (!/^[$A-Z_a-z][$\w]*$/.test(name)) {
			throw new Error(`${moduleId} 包含无法桥接的导出名：${name}`);
		}
		const binding = `__splitExport${index}`;
		lines.push(`const ${binding} = __splitModule[${JSON.stringify(name)}];`);
		lines.push(`export { ${binding} as ${name} };`);
	}
	return `${lines.join('\n')}\n`;
}

async function verifyTestEntry() {
	const testFiles = (await readdir(testsDirectory))
		.filter((name) => name.endsWith('.test.ts'))
		.sort();
	const runSource = await readFile(runPath, 'utf8');
	const importedTests = [...runSource.matchAll(
		/import\s+['"]\.\/([^'"]+\.test)\.js['"];/g,
	)].map((match) => `${match[1]}.ts`);
	const missingTests = testFiles.filter((name) => !importedTests.includes(name));
	const unknownImports = importedTests.filter((name) => !testFiles.includes(name));
	const duplicateImports = importedTests.filter(
		(name, index) => importedTests.indexOf(name) !== index,
	);
	if (missingTests.length || unknownImports.length || duplicateImports.length) {
		throw new Error(
			`main-lite 测试入口不完整：missing=${missingTests.join(',') || '-'}; ` +
			`unknown=${unknownImports.join(',') || '-'}; ` +
			`duplicate=${[...new Set(duplicateImports)].join(',') || '-'}`,
		);
	}
	return testFiles;
}

async function loadSplitRuntime() {
	for (const libraryPath of libraryPaths) {
		const source = await readFile(libraryPath, 'utf8');
		runInThisContext(source, { filename: libraryPath });
	}
	const runtime = globalThis[runtimeKey];
	if (!runtime || typeof runtime.start !== 'function') {
		throw new Error('四文件产物没有注册 Lite 模块 runtime');
	}
	return runtime;
}

async function verifyStartupGuards(runtime) {
	const entryPath = path.join(sourceDirectory, 'userscript/main-lite-entry.ts');
	const entry = await transform(await readFile(entryPath, 'utf8'), {
		loader: 'ts', format: 'cjs', target: 'es2022',
	});
	const page = {};
	const scriptGlobal = Object.defineProperty({}, 'window', { get: () => page });
	let captured;
	new Script(
		'(function (GM_getValue, GM_getResourceText, unsafeWindow, globalThis) {\n' +
		entry.code + '\n})(__readValue, __readResource, window, __global);',
	).runInNewContext({
		window: page,
		__global: scriptGlobal,
		__readValue: (key) => `value:${key}`,
		__readResource: (key) => `resource:${key}`,
		require(request) {
			assert.equal(request, './main-lite-bootstrap.js');
			return { startMainLiteUserscript: (environment) => { captured = environment; } };
		},
	}, { timeout: 1000 });
	assert.equal(captured.window, page);
	assert.equal(captured.unsafeWindow, page);
	assert.equal(captured.GM_getValue('probe'), 'value:probe');
	assert.equal(captured.GM_getResourceText('styles'), 'resource:styles');
	assert.equal(Object.getOwnPropertyDescriptor(captured, 'window').writable, true);
	let failedAttempts = 0;
	let healthyAttempts = 0;
	runtime.register('test/startup-failure.js', () => {
		failedAttempts += 1;
		throw new Error('startup failure fixture');
	}, 'a'.repeat(64));
	runtime.register('test/startup-healthy.js', (module) => {
		healthyAttempts += 1;
		module.exports = { ready: true };
	}, 'b'.repeat(64));
	assert.throws(() => runtime.start('test/startup-failure.js', expectedLibraries), /startup failure fixture/);
	for (let attempt = 0; attempt < 50; attempt += 1) {
		assert.equal(runtime.start('test/startup-failure.js', expectedLibraries), undefined);
	}
	assert.equal(failedAttempts, 1, '失败入口不得再次初始化或重复抛错');
	const healthy = runtime.start('test/startup-healthy.js', expectedLibraries);
	assert.equal(runtime.start('test/startup-healthy.js', expectedLibraries), healthy);
	assert.equal(healthyAttempts, 1, '成功模块仍须复用缓存');
	assert.equal(healthy.ready, true, '失败锁定不得影响其他模块');
	assert.throws(() => runtime.start('test/missing-library.js', ['missing-fixture']), /missing library/);
	assert.equal(runtime.start('test/missing-library.js', ['missing-fixture']), undefined);
	process.stdout.write('main-lite startup guards: passed (lexical GM, readonly Window, single failure)\n');
}

async function run() {
	const testFiles = await verifyTestEntry();
	const runtime = await loadSplitRuntime();
	await verifyStartupGuards(runtime);
	const result = await build({
		entryPoints: [runPath],
		bundle: true,
		format: 'esm',
		legalComments: 'none',
		minify: false,
		platform: 'node',
		plugins: [{
			name: 'main-lite-split-runtime',
			setup(buildContext) {
				buildContext.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => {
					const candidate = path.resolve(args.resolveDir, args.path);
					if (!isSourcePath(candidate)) return undefined;
					return { path: candidate, namespace: 'main-lite-split-runtime' };
				});
				buildContext.onLoad(
					{ filter: /.*/, namespace: 'main-lite-split-runtime' },
					(args) => {
						const moduleId = moduleIdForPath(args.path);
						const moduleExports = runtime.start(moduleId, expectedLibraries);
						return {
							contents: renderModuleBridge(moduleId, moduleExports),
							loader: 'js',
						};
					},
				);
			},
		}],
		sourcemap: false,
		target: 'node20',
		treeShaking: false,
		write: false,
	});
	if (result.warnings.length) {
		throw new Error(`main-lite 四文件测试构建返回 ${result.warnings.length} 条警告`);
	}
	const outputFile = result.outputFiles?.[0];
	if (!outputFile) throw new Error('main-lite 四文件测试构建无输出');
	const moduleUrl = `data:text/javascript;base64,${Buffer.from(outputFile.text).toString('base64')}`;
	await import(moduleUrl);
	process.stdout.write(`main-lite split contract tests: passed (${testFiles.length} files)\n`);
}

try {
	await run();
} catch (error) {
	const name = error instanceof Error ? error.name : 'UnknownError';
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`main-lite split contract tests: failed: ${name}: ${message}\n`);
	process.exitCode = 1;
}
