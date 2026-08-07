import { build } from 'esbuild';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const testsDirectory = path.join(projectRoot, 'lite/tests');
const runPath = path.join(testsDirectory, 'run.ts');
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
		`mian-lite 测试入口不完整：missing=${missingTests.join(',') || '-'}; ` +
		`unknown=${unknownImports.join(',') || '-'}; ` +
		`duplicate=${[...new Set(duplicateImports)].join(',') || '-'}`,
	);
}
const result = await build({
	entryPoints: [runPath],
	bundle: true,
	format: 'esm',
	legalComments: 'none',
	minify: false,
	platform: 'node',
	sourcemap: false,
	target: 'node20',
	treeShaking: false,
	write: false,
});
if (result.warnings.length) {
	throw new Error(`mian-lite 测试构建返回 ${result.warnings.length} 条警告`);
}
const outputFile = result.outputFiles?.[0];
if (!outputFile) throw new Error('mian-lite 测试构建无输出');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(outputFile.text).toString('base64')}`;
try {
	await import(moduleUrl);
} catch (error) {
	const name = error instanceof Error ? error.name : 'UnknownError';
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`mian-lite contract tests: failed: ${name}: ${message}\n`);
	process.exitCode = 1;
	process.exit();
}
process.stdout.write(`mian-lite contract tests: passed (${testFiles.length} files)\n`);
