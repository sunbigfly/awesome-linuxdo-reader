import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import traversePackage from '@babel/traverse';

const SOURCE_PATH = 'work/main.js';
const ROOT_OWNER = '<runtime-root>';
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const traverse = traversePackage.default ?? traversePackage;

function parseArgs(args) {
	if (args.length === 0) return { format: 'markdown' };
	if (args.length === 2 && args[0] === '--format' && ['json', 'markdown'].includes(args[1])) {
		return { format: args[1] };
	}
	throw new Error('仅支持可选参数：--format json|markdown');
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

function findRuntimeIife(program) {
	for (const statement of program.body) {
		if (statement.type !== 'ExpressionStatement') continue;
		const expression = statement.expression;
		if (expression?.type !== 'CallExpression') continue;
		const callee = expression.callee;
		if (callee?.type === 'FunctionExpression' || callee?.type === 'ArrowFunctionExpression') {
			return callee;
		}
	}
	throw new Error('未找到 userscript 外层运行时 IIFE');
}

const { format } = parseArgs(process.argv.slice(2));
const source = await readFile(path.join(projectRoot, SOURCE_PATH), 'utf8');
const ast = parse(source, {
	allowAwaitOutsideFunction: true,
	allowReturnOutsideFunction: false,
	errorRecovery: false,
	sourceType: 'script',
	plugins: ['classProperties', 'classPrivateProperties', 'classPrivateMethods'],
});
const runtimeIife = findRuntimeIife(ast.program);
const definitions = [];
const definitionByNode = new Map();
const definitionsByName = new Map();
const stringLiteralCounts = new Map();
const lexicalBindings = new Set();

function registerDefinition(name, functionPath, binding) {
	if (!binding || definitionByNode.has(functionPath.node)) return;
	const node = functionPath.node;
	const lineStart = node.loc?.start.line ?? 0;
	const lineEnd = node.loc?.end.line ?? lineStart;
	const id = `${name}@${lineStart}:${node.loc?.start.column ?? 0}`;
	const bodySource = source.slice(node.body?.start ?? node.start, node.body?.end ?? node.end);
	const entry = {
		id,
		name,
		lineStart,
		lineEnd,
		bytes: Buffer.byteLength(source.slice(node.start, node.end)),
		bodyBytes: Buffer.byteLength(bodySource),
		bodyHash: sha256(bodySource.replace(/\s+/g, ' ').trim()),
		node,
		binding,
	};
	definitions.push(entry);
	definitionByNode.set(node, entry);
	const sameName = definitionsByName.get(name) ?? [];
	sameName.push(entry);
	definitionsByName.set(name, sameName);
}

traverse(ast, {
	Scopable(path) {
		for (const binding of Object.values(path.scope.bindings)) lexicalBindings.add(binding);
	},
	FunctionDeclaration(path) {
		if (path.node === runtimeIife || path.node.id?.type !== 'Identifier') return;
		const name = path.node.id.name;
		registerDefinition(name, path, path.parentPath.scope.getBinding(name));
	},
	VariableDeclarator(path) {
		if (path.node.id.type !== 'Identifier') return;
		const initPath = path.get('init');
		if (!initPath.isFunctionExpression() && !initPath.isArrowFunctionExpression()) return;
		const name = path.node.id.name;
		registerDefinition(name, initPath, path.scope.getBinding(name));
	},
	StringLiteral(path) {
		const value = path.node.value;
		stringLiteralCounts.set(value, (stringLiteralCounts.get(value) ?? 0) + 1);
	},
});

function ownerForReference(referencePath) {
	let current = referencePath;
	while (current) {
		if (current.node === runtimeIife) return ROOT_OWNER;
		const definition = definitionByNode.get(current.node);
		if (definition) return definition.id;
		current = current.parentPath;
	}
	return null;
}

const edges = new Map([[ROOT_OWNER, new Set()]]);
for (const definition of definitions) {
	edges.set(definition.id, new Set());
}
for (const definition of definitions) {
	for (const referencePath of definition.binding.referencePaths) {
		const owner = ownerForReference(referencePath);
		if (!owner) continue;
		const ownerEdges = edges.get(owner) ?? new Set();
		ownerEdges.add(definition.id);
		edges.set(owner, ownerEdges);
	}
}

const reachable = new Set([ROOT_OWNER]);
const queue = [ROOT_OWNER];
while (queue.length) {
	const owner = queue.shift();
	for (const target of edges.get(owner) ?? []) {
		if (reachable.has(target)) continue;
		reachable.add(target);
		queue.push(target);
	}
}

const duplicateNames = [...definitionsByName.entries()]
	.filter(([, entries]) => entries.length > 1)
	.map(([name, entries]) => ({
		name,
		locations: entries.map((entry) => `${entry.lineStart}-${entry.lineEnd}`),
	}));
const definitionsByBodyHash = new Map();
for (const entry of definitions.filter((candidate) => candidate.bodyBytes >= 80)) {
	const sameBody = definitionsByBodyHash.get(entry.bodyHash) ?? [];
	sameBody.push(entry);
	definitionsByBodyHash.set(entry.bodyHash, sameBody);
}
const exactDuplicateBodies = [...definitionsByBodyHash.entries()]
	.filter(([, entries]) => entries.length > 1)
	.map(([bodyHash, entries]) => ({
		bodyHash,
		functions: entries.map((entry) => ({
			name: entry.name,
			lineStart: entry.lineStart,
			lineEnd: entry.lineEnd,
		})),
	}));
const candidates = definitions
	.filter((entry) => !reachable.has(entry.id))
	.map((entry) => ({
		name: entry.name,
		lineStart: entry.lineStart,
		lineEnd: entry.lineEnd,
		bytes: entry.bytes,
		staticReferenceCount: entry.binding.referencePaths.length,
		exactStringLiteralCount: stringLiteralCounts.get(entry.name) ?? 0,
		reason: entry.binding.referencePaths.length === 0
			? 'zero-static-reference'
			: 'only-referenced-from-unreachable-functions',
	}))
	.sort((left, right) => left.lineStart - right.lineStart || left.name.localeCompare(right.name));
const zeroReferenceCandidates = candidates.filter(
	(candidate) => candidate.staticReferenceCount === 0,
);
const unusedBindings = [...lexicalBindings]
	.filter((binding) => !binding.referenced)
	.map((binding) => ({
		name: binding.identifier.name,
		line: binding.identifier.loc?.start.line ?? 0,
		kind: binding.kind,
		pathType: binding.path.type,
		constantViolations: binding.constantViolations.length,
	}))
	.sort((left, right) => left.line - right.line || left.name.localeCompare(right.name));
const unusedNonParameterBindings = unusedBindings.filter((binding) => binding.kind !== 'param');
const report = {
	schemaVersion: 1,
	source: SOURCE_PATH,
	sourceBytes: Buffer.byteLength(source),
	sourceSha256: sha256(source),
	runtimeRoot: {
		lineStart: runtimeIife.loc?.start.line ?? 0,
		lineEnd: runtimeIife.loc?.end.line ?? 0,
	},
	summary: {
		functionDefinitions: definitions.length,
		reachableFunctions: definitions.filter((entry) => reachable.has(entry.id)).length,
		unreachableCandidates: candidates.length,
		zeroReferenceCandidates: zeroReferenceCandidates.length,
		duplicateNames: duplicateNames.length,
		exactDuplicateBodies: exactDuplicateBodies.length,
		lexicalBindings: lexicalBindings.size,
		unusedBindings: unusedBindings.length,
		unusedNonParameterBindings: unusedNonParameterBindings.length,
	},
	candidates,
	unusedBindings,
	duplicateNames,
	exactDuplicateBodies,
	limitations: [
		'静态分析不会证明字符串反射、宿主框架隐式调用或外部代码持有的回调。',
		'候选项必须再经过精确引用、注册表、文档契约和真实浏览器行为核验后才能删除。',
		'匿名回调的引用归属其最近具名函数；从运行时根注册的匿名回调按可达处理。',
	],
};

if (format === 'json') {
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
	const lines = [
		'# main.js 运行时可达性审计',
		'',
		`- 源码：\`${report.source}\`（${report.sourceBytes} bytes）`,
		`- SHA-256：\`${report.sourceSha256}\``,
		`- 具名函数：${report.summary.functionDefinitions}`,
		`- 从运行时根可达：${report.summary.reachableFunctions}`,
		`- 不可达候选：${report.summary.unreachableCandidates}`,
		`- 其中零静态引用：${report.summary.zeroReferenceCandidates}`,
		`- 重名函数：${report.summary.duplicateNames}`,
		`- 完全相同函数体：${report.summary.exactDuplicateBodies}`,
		`- 词法 binding：${report.summary.lexicalBindings}`,
		`- 未使用 binding：${report.summary.unusedBindings}（非参数 ${report.summary.unusedNonParameterBindings}）`,
		'',
		'## 不可达候选',
		'',
		'| 函数 | 行 | 字节 | 静态引用 | 同名字符串 | 原因 |',
		'| --- | ---: | ---: | ---: | ---: | --- |',
		...candidates.map((candidate) =>
			`| \`${candidate.name}\` | ${candidate.lineStart}-${candidate.lineEnd} | ${candidate.bytes} | ` +
			`${candidate.staticReferenceCount} | ${candidate.exactStringLiteralCount} | ${candidate.reason} |`,
		),
		'',
		'## 未使用词法 binding',
		'',
		'| 名称 | 行 | 类型 | AST 路径 | 再赋值 |',
		'| --- | ---: | --- | --- | ---: |',
		...unusedBindings.map((binding) =>
			`| \`${binding.name}\` | ${binding.line} | ${binding.kind} | ${binding.pathType} | ` +
			`${binding.constantViolations} |`,
		),
		'',
		'## 限制',
		'',
		...report.limitations.map((limitation) => `- ${limitation}`),
	];
	process.stdout.write(`${lines.join('\n')}\n`);
}
