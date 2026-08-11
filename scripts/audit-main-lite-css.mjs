import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import traversePackage from '@babel/traverse';

const traverse = traversePackage.default ?? traversePackage;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const sourceRoot = path.join(projectRoot, 'lite/src');
const styleRoot = path.join(projectRoot, 'lite/styles');
const styleManifestPath = path.join(styleRoot, 'manifest.json');
const stylesheetPath = path.join(projectRoot, 'work/main-lite.css');
const referenceRuntimePath = path.join(projectRoot, 'work/main.js');
const expectedProofScope = 'static-dom-css-ownership-only';
const styleManifest = JSON.parse(await readFile(styleManifestPath, 'utf8'));
const embeddedStyleRuntimeFiles = new Set(
	Array.isArray(styleManifest.embeddedStyleRuntimeFiles)
		? styleManifest.embeddedStyleRuntimeFiles.map((value) => String(value))
		: [],
);

async function collectFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const target = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...await collectFiles(target));
		else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(target);
	}
	return files;
}

const runtimeClassPattern =
	/(?<![a-z0-9_-])ldp-[a-z0-9_-]+(?![a-z0-9_-])/gi;
const classBuilderArguments = new Map([
	['button', [1]],
	['createHtmlElement', [2]],
	['createReaderIcon', [2]],
	['element', [2]],
	['node', [2]],
	['settingsButton', [1]],
	['settingsCopy', [1]],
	['settingsElement', [2]],
	['settingsSection', [1]],
]);

function staticStringFragments(node) {
	if (!node) return [];
	if (node.type === 'StringLiteral') return [node.value];
	if (node.type === 'TemplateLiteral') {
		return node.quasis.map((part) => part.value.cooked ?? part.value.raw);
	}
	if (
		node.type === 'LogicalExpression' ||
		node.type === 'BinaryExpression'
	) {
		return [
			...staticStringFragments(node.left),
			...staticStringFragments(node.right),
		];
	}
	if (node.type === 'ConditionalExpression') {
		return [
			...staticStringFragments(node.consequent),
			...staticStringFragments(node.alternate),
		];
	}
	if (
		node.type === 'TSAsExpression' ||
		node.type === 'TSSatisfiesExpression' ||
		node.type === 'TSNonNullExpression' ||
		node.type === 'ParenthesizedExpression'
	) {
		return staticStringFragments(node.expression);
	}
	return [];
}

function staticString(node) {
	return staticStringFragments(node).join('') || null;
}

function runtimeClasses(value) {
	return [...new Set(
		[...String(value ?? '').matchAll(runtimeClassPattern)]
			.map((match) => match[0])
			.filter((className) =>
				!className.endsWith('-') && !className.endsWith('_')),
	)];
}

function memberName(node) {
	if (
		node?.type !== 'MemberExpression' ||
		node.computed ||
		node.property.type !== 'Identifier'
	) {
		return null;
	}
	return node.property.name;
}

function argumentAt(node, index) {
	const argument = node.arguments[index];
	if (
		!argument ||
		argument.type === 'SpreadElement' ||
		argument.type === 'ArgumentPlaceholder'
	) {
		return null;
	}
	return argument;
}

function collectRuntimeClassGroups(filePath, source) {
	const groups = [];
	const record = (node, value, kind) => {
		const classes = runtimeClasses(value);
		if (!classes.length) return;
		groups.push(Object.freeze({
			file: path.relative(projectRoot, filePath).replaceAll('\\', '/'),
			line: node.loc?.start.line ?? 0,
			kind,
			classes: Object.freeze(classes),
		}));
	};
	const recordNode = (node, valueNode, kind) => {
		for (const value of staticStringFragments(valueNode)) {
			record(node, value, kind);
		}
	};
	const recordHtmlClasses = (node, value) => {
		for (const match of String(value ?? '').matchAll(
			/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/gi,
		)) {
			record(node, match[1] ?? match[2] ?? '', 'html-class');
		}
	};
	const ast = parse(source, {
		sourceType: 'module',
		plugins: ['typescript'],
	});
	traverse(ast, {
		AssignmentExpression(nodePath) {
			const { node } = nodePath;
			if (memberName(node.left) === 'className') {
				recordNode(node, node.right, 'className');
			}
		},
		ObjectProperty(nodePath) {
			const { node } = nodePath;
			const key = node.key.type === 'Identifier'
				? node.key.name
				: staticString(node.key);
			if (key === 'className') {
				recordNode(node, node.value, 'className-property');
			}
		},
		CallExpression(nodePath) {
			const { node } = nodePath;
			const method = memberName(node.callee);
			if (
				method &&
				['add', 'remove', 'toggle'].includes(method) &&
				memberName(node.callee.object) === 'classList'
			) {
				for (const argument of node.arguments) {
					if (
						argument.type === 'SpreadElement' ||
						argument.type === 'ArgumentPlaceholder'
					) {
						continue;
					}
					recordNode(
						node,
						argument,
						`classList.${method}`,
					);
				}
			}
			if (
				method === 'setAttribute' &&
				staticString(argumentAt(node, 0)) === 'class'
			) {
				recordNode(
					node,
					argumentAt(node, 1),
					'setAttribute-class',
				);
			}
			if (
				node.callee.type === 'Identifier' &&
				classBuilderArguments.has(node.callee.name)
			) {
				for (const index of classBuilderArguments.get(node.callee.name)) {
					recordNode(
						node,
						argumentAt(node, index),
						`${node.callee.name}[${index}]`,
					);
				}
			}
			if (
				node.callee.type === 'Identifier' &&
				node.callee.name === 'settingsSwitch'
			) {
				for (const value of staticStringFragments(argumentAt(node, 2))) {
					record(
						node,
						`ldp-setting-switch ${value}`,
						'settingsSwitch[2]',
					);
				}
			}
			if (
				node.callee.type === 'Identifier' &&
				node.callee.name === 'settingsOptionRow'
			) {
				for (const value of staticStringFragments(argumentAt(node, 4))) {
					record(
						node,
						`ldp-setting-row ldp-setting-option-row ${value}`,
						'settingsOptionRow[4]',
					);
				}
			}
			if (
				node.callee.type === 'Identifier' &&
				node.callee.name === 'settingsFooter'
			) {
				const options = argumentAt(node, 2);
				if (options?.type === 'ObjectExpression') {
					for (const property of options.properties) {
						if (property.type !== 'ObjectProperty') continue;
						const key = property.key.type === 'Identifier'
							? property.key.name
							: staticString(property.key);
						if (!key?.endsWith('Class')) continue;
						recordNode(
							node,
							property.value,
							`settingsFooter.${key}`,
						);
					}
				}
			}
		},
		StringLiteral(nodePath) {
			recordHtmlClasses(nodePath.node, nodePath.node.value);
		},
		TemplateLiteral(nodePath) {
			if (nodePath.node.expressions.length) return;
			recordHtmlClasses(
				nodePath.node,
				staticString(nodePath.node),
			);
		},
	});
	return groups;
}

const sourceClasses = new Set();
const runtimeClassGroups = [];
for (const file of await collectFiles(sourceRoot)) {
	const source = await readFile(file, 'utf8');
	for (const className of runtimeClasses(source)) sourceClasses.add(className);
	const relativeFile = path.relative(projectRoot, file).replaceAll('\\', '/');
	if (!embeddedStyleRuntimeFiles.has(relativeFile)) {
		runtimeClassGroups.push(...collectRuntimeClassGroups(file, source));
	}
}
const stylesheet = await readFile(stylesheetPath, 'utf8');
const referenceRuntime = await readFile(referenceRuntimePath, 'utf8');
if (styleManifest.proofScope !== expectedProofScope) {
	throw new Error(`frontend manifest proofScope 必须为 ${expectedProofScope}`);
}
if (styleManifest.alignmentDecision !== 'not-evaluated') {
	throw new Error('frontend manifest 不能自行声明业务或渲染对齐结论');
}
const styleSources = Array.isArray(styleManifest.sources)
	? styleManifest.sources
	: [];
if (!styleSources.length) {
	throw new Error('lite/styles/manifest.json 未声明 CSS source');
}
const surfaceContracts = Array.isArray(styleManifest.surfaces)
	? styleManifest.surfaces
	: [];
if (!surfaceContracts.length) {
	throw new Error('lite/styles/manifest.json 未声明 frontend surface contract');
}
const styleSourceTexts = new Map();
for (const sourceName of styleSources) {
	styleSourceTexts.set(
		sourceName,
		await readFile(path.join(styleRoot, sourceName), 'utf8'),
	);
}
const referenceRuntimeClasses = new Set(
	runtimeClasses(referenceRuntime),
);
const styledClasses = new Set(
	[...stylesheet.matchAll(/\.((?:ldp-)[a-z0-9_-]+)/gi)].map((match) => match[1]),
);
const sourceOnly = [...sourceClasses]
	.filter((className) => !styledClasses.has(className))
	.sort();
const cssOnly = [...styledClasses]
	.filter((className) => !sourceClasses.has(className))
	.sort();
const ownedClasses = new Set([...sourceClasses, ...referenceRuntimeClasses]);
const unownedCssClasses = [...styledClasses]
	.filter((className) => !ownedClasses.has(className))
	.sort();
const referenceRuntimeOnly = [...referenceRuntimeClasses]
	.filter((className) => !sourceClasses.has(className))
	.sort();
const uniqueRuntimeClassGroups = new Map();
for (const group of runtimeClassGroups) {
	const key = `${group.kind}:${group.classes.join(' ')}`;
	if (!uniqueRuntimeClassGroups.has(key)) uniqueRuntimeClassGroups.set(key, group);
}
const nonVisualRuntimeClasses = new Set(
	Array.isArray(styleManifest.nonVisualRuntimeClasses)
		? styleManifest.nonVisualRuntimeClasses
		: [],
);
const uncoveredGroupClasses = (group, styled, nonVisual) =>
	group.classes.filter((className) =>
		!styled.has(className) && !nonVisual.has(className));
const compoundCoverageCounterexample = uncoveredGroupClasses(
	{ classes: ['ldp-example-styled', 'ldp-example-missing'] },
	new Set(['ldp-example-styled']),
	new Set(),
);
if (
	compoundCoverageCounterexample.length !== 1 ||
	compoundCoverageCounterexample[0] !== 'ldp-example-missing'
) {
	throw new Error('CSS audit 复合 class 逐 token 覆盖反例失效');
}
const uncoveredRuntimeClassGroups = [...uniqueRuntimeClassGroups.values()]
	.map((group) => Object.freeze({
		...group,
		uncoveredClasses: Object.freeze(uncoveredGroupClasses(
			group,
			styledClasses,
			nonVisualRuntimeClasses,
		)),
	}))
	.filter((group) => group.uncoveredClasses.length)
	.sort((left, right) =>
		left.file.localeCompare(right.file) || left.line - right.line);
const runtimeClassTokens = new Set(
	[...uniqueRuntimeClassGroups.values()]
		.flatMap((group) => group.classes),
);
const unstyledRuntimeClasses = [...runtimeClassTokens]
	.filter((className) => !styledClasses.has(className))
	.sort();
const unexpectedUnstyledRuntimeClasses = unstyledRuntimeClasses
	.filter((className) => !nonVisualRuntimeClasses.has(className));
const staleNonVisualRuntimeClasses = [...nonVisualRuntimeClasses]
	.filter((className) =>
		!runtimeClassTokens.has(className) || styledClasses.has(className))
	.sort();

async function readContractFiles(filePaths, prefix = '') {
	const values = [];
	for (const filePath of filePaths) {
		const target = path.join(projectRoot, prefix, filePath);
		values.push(await readFile(target, 'utf8'));
	}
	return values;
}

const surfaceContractErrors = [];
const surfaceIds = new Set();
for (const surface of surfaceContracts) {
	const id = String(surface.id ?? '').trim();
	if (!id || surfaceIds.has(id)) {
		surfaceContractErrors.push(`surface id 非法或重复：${id || '(empty)'}`);
		continue;
	}
	surfaceIds.add(id);
	const owners = Array.isArray(surface.owners) ? surface.owners : [];
	const styles = Array.isArray(surface.styles) ? surface.styles : [];
	const tests = Array.isArray(surface.tests) ? surface.tests : [];
	const classes = Array.isArray(surface.runtimeClasses)
		? surface.runtimeClasses
		: [];
	const styleSignatures = Array.isArray(surface.styleSignatures)
		? surface.styleSignatures
		: [];
	const exclusiveRuntimeClasses = Array.isArray(
		surface.exclusiveRuntimeClasses,
	)
		? surface.exclusiveRuntimeClasses
		: [];
	if (!owners.length || !styles.length || !tests.length || !classes.length) {
		surfaceContractErrors.push(`${id} 缺少 owner/style/test/runtimeClasses`);
		continue;
	}
	try {
		const ownerSources = (await readContractFiles(owners)).join('\n');
		const styleTexts = (
			await readContractFiles(styles, 'lite/styles')
		).join('\n');
		await readContractFiles(tests);
		const ownerClasses = new Set(runtimeClasses(ownerSources));
		const surfaceStyledClasses = new Set(
			[...styleTexts.matchAll(/\.((?:ldp-)[a-z0-9_-]+)/gi)]
				.map((match) => match[1]),
		);
		for (const className of classes) {
			if (!ownerClasses.has(className)) {
				surfaceContractErrors.push(
					`${id} owner 未产出 ${className}`,
				);
			}
			if (!surfaceStyledClasses.has(className)) {
				surfaceContractErrors.push(
					`${id} style 未拥有 ${className}`,
				);
			}
		}
		for (const signature of styleSignatures) {
			if (
				typeof signature !== 'string' ||
				!signature ||
				!styleTexts.includes(signature)
			) {
				surfaceContractErrors.push(
					`${id} style 缺少签名 ${String(signature)}`,
				);
			}
		}
		for (const className of exclusiveRuntimeClasses) {
			const unexpectedOwners = styleSources.filter((sourceName) =>
				!styles.includes(sourceName) &&
				new RegExp(`\\.${className}(?![a-z0-9_-])`, 'i').test(
					styleSourceTexts.get(sourceName) ?? '',
				),
			);
			if (unexpectedOwners.length) {
				surfaceContractErrors.push(
					`${id} 独占 class ${className} 被其他样式层声明：${unexpectedOwners.join(',')}`,
				);
			}
		}
	} catch (error) {
		surfaceContractErrors.push(
			`${id} 文件不可读：${String(error)}`,
		);
	}
}

function selectorsFrom(css) {
	const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
	const selectors = [];
	for (const match of withoutComments.matchAll(/([^{}]+)\{/g)) {
		const header = match[1].trim();
		if (
			!header ||
			header.startsWith('@') ||
			/^(?:from|to|\d+(?:\.\d+)?%)$/i.test(header)
		) {
			continue;
		}
		let start = 0;
		let depth = 0;
		for (let index = 0; index <= header.length; index += 1) {
			const character = header[index];
			if (character === '(' || character === '[') depth += 1;
			else if (character === ')' || character === ']') depth -= 1;
			if ((character === ',' && depth === 0) || index === header.length) {
				const selector = header.slice(start, index).trim();
				if (
					selector &&
					!/^(?:from|to|\d+(?:\.\d+)?%)$/i.test(selector)
				) {
					selectors.push(selector);
				}
				start = index + 1;
			}
		}
	}
	return selectors;
}

const selectorOwners = new Map();
const unscopedSelectors = [];
for (const sourceName of styleSources) {
	const source = styleSourceTexts.get(sourceName) ?? '';
	for (const selector of selectorsFrom(source)) {
		const owners = selectorOwners.get(selector) ?? new Set();
		owners.add(sourceName);
		selectorOwners.set(selector, owners);
		if (
			!/^(?:from|to|\d+(?:\.\d+)?%)$/i.test(selector) &&
			!/\bldp[-_]/i.test(selector) &&
			!/\[data-ldp[-_]/i.test(selector)
		) {
			unscopedSelectors.push(`${sourceName}: ${selector}`);
		}
	}
}
const crossFileDuplicateSelectors = [...selectorOwners]
	.filter(([, owners]) => owners.size > 1)
	.map(([selector, owners]) => Object.freeze({
		selector,
		sources: [...owners].sort(),
	}))
	.sort((left, right) => left.selector.localeCompare(right.selector));
const forbidden = [
	['main.css reference', /main\.css/i],
	['remote import', /@import\b/i],
	['global wildcard reset', /(^|})\s*\*\s*{/m],
].filter(([, pattern]) => pattern.test(stylesheet)).map(([name]) => name);
const requiredLayoutContracts = [
	[
		'28px thread avatar token',
		/--ldp-thread-avatar-size:\s*28px\s*;/,
	],
	[
		'8px thread head gap token',
		/--ldp-thread-head-gap:\s*8px\s*;/,
	],
	[
		'single reply-tree anchor',
		/\.ldp-reply-list\s*\{[^}]*margin-inline-start:\s*0\s*;/s,
	],
	[
		'root content avatar offset',
		/\.ldp-post-body\s*>\s*\.ldp-content\s*\{[^}]*margin-left:\s*var\(--ldp-thread-avatar-size\)\s*;/s,
	],
	[
		'nested content avatar offset',
		/\.ldp-reply-list\s*>\s*\.ldp-post\s*>\s*\.ldp-post-body\s*>\s*\.ldp-content\s*\{[^}]*margin-left:\s*var\(--ldp-thread-avatar-size\)\s*;/s,
	],
	[
		'single body scroll owner',
		/\.ldp-virtual-stream\s*\{[^}]*height:\s*auto\s*;[^}]*overflow:\s*visible\s*;/s,
	],
	[
		'native virtual-stream anchor owner',
		/\.ldp-virtual-stream\s*\{[^}]*overflow-anchor:\s*auto\s*;/s,
	],
	[
		'floating virtual stream excluded from duplicate native anchoring',
		/\.ldp-overlay\.ldp-window-managed:not\(\.ldp-fullpage\):not\(\.ldp-reader-embedded\)[^{]*\.ldp-virtual-stream\s*\{[^}]*overflow-anchor:\s*none\s*;/s,
	],
	[
		'virtual spacers excluded from anchoring',
		/\.ldp-virtual-spacer\s*\{[^}]*overflow-anchor:\s*none\s*;/s,
	],
	[
		'native settings switch state',
		/\.ldp-setting-switch:has\(>\s*input:checked\)/,
	],
	[
		'dark theme danger token',
		/\[data-ldp-theme="dark"\][^{]*\{[^}]*--danger:\s*#ff7b72\s*;/s,
	],
	[
		'dark theme highlight token',
		/\[data-ldp-theme="dark"\][^{]*\{[^}]*--highlight:\s*#6b5a16\s*;/s,
	],
	[
		'host font rendering projection',
		/html\[data-ldp-font-rendering="builtin"\]\[data-ldp-font-rendering-host="true"\]\s+body/,
	],
	[
		'native composer font rendering projection',
		/html\.ldp-reader-open\[data-ldp-font-rendering="builtin"\][^{]*\[data-ldp-reader-composer-root\]/,
	],
	[
		'font rendering code and icon reset',
		/-webkit-text-stroke:\s*0\s+transparent\s*;[^}]*text-shadow:\s*none\s*;/s,
	],
	[
		'reader image scale projection',
		/:is\(\.ldp-content,\.ldp-solved-excerpt\)\s+img:not\(\.emoji\)\s*\{[^}]*zoom:\s*var\(--ldp-image-zoom,\s*1\)\s*;/s,
	],
	[
		'lightbox comments width inheritance',
		/\.ldp-lightbox\s*\{(?:(?!--ldp-lb-comments-width-preferred:\s*25%).)*--ldp-lb-comments-width:\s*clamp\(min\(240px,\s*50%\),\s*var\(--ldp-lb-comments-width-preferred,\s*25%\),\s*50%\)\s*;/s,
	],
];
const missingLayoutContracts = requiredLayoutContracts
	.filter(([, pattern]) => !pattern.test(stylesheet))
	.map(([name]) => name);
if (forbidden.length) {
	throw new Error(`main-lite.css 命中禁止项：${forbidden.join(', ')}`);
}
if (missingLayoutContracts.length) {
	throw new Error(
		`main-lite.css 缺少像素布局契约：${missingLayoutContracts.join(', ')}`,
	);
}
if (unownedCssClasses.length) {
	throw new Error(
		`main-lite.css 存在无运行时所有者的 class：${unownedCssClasses.join(', ')}`,
	);
}
if (unscopedSelectors.length) {
	throw new Error(
		`main-lite.css 存在未锚定到 Lite surface 的 selector：` +
		unscopedSelectors.slice(0, 20).join(' | '),
	);
}
if (uncoveredRuntimeClassGroups.length) {
	throw new Error(
		'main-lite.css 存在未覆盖的运行时 DOM class 组：' +
		uncoveredRuntimeClassGroups
			.slice(0, 20)
			.map((group) =>
				`${group.file}:${group.line} ${group.uncoveredClasses.join(' ')}`)
			.join(' | '),
	);
}
if (unexpectedUnstyledRuntimeClasses.length) {
	throw new Error(
		'main-lite.css 存在未分类的无样式运行时 class：' +
		unexpectedUnstyledRuntimeClasses.join(', '),
	);
}
if (staleNonVisualRuntimeClasses.length) {
	throw new Error(
		'frontend non-visual class 清单已陈旧：' +
		staleNonVisualRuntimeClasses.join(', '),
	);
}
if (surfaceContractErrors.length) {
	throw new Error(
		'frontend surface contract 不完整：' +
		surfaceContractErrors.slice(0, 30).join(' | '),
	);
}

process.stdout.write(`${JSON.stringify({
	schemaVersion: 3,
	manifestSchemaVersion: styleManifest.schemaVersion,
	gate: 'lite-css-static-integrity',
	proofScope: expectedProofScope,
	alignmentEvaluation: 'not-evaluated',
	baselineInputs: Object.freeze(['work/main.js']),
	proves: Object.freeze([
		'Lite runtime class ownership',
		'Lite stylesheet coverage and scoping',
		'declared surface owner style test file presence',
		'declared CSS signature presence',
	]),
	doesNotProve: Object.freeze([
		'work/main.css declaration equivalence',
		'computed style equivalence',
		'layout geometry animation or interaction parity',
		'real browser rendering',
	]),
	styleSourceCount: styleSources.length,
	sourceClassCount: sourceClasses.size,
	referenceRuntimeClassCount: referenceRuntimeClasses.size,
	styledClassCount: styledClasses.size,
	runtimeClassGroupCount: uniqueRuntimeClassGroups.size,
	uncoveredRuntimeClassGroupCount: uncoveredRuntimeClassGroups.length,
	runtimeClassTokenCount: runtimeClassTokens.size,
	unstyledRuntimeClassCount: unstyledRuntimeClasses.length,
	nonVisualRuntimeClassCount: nonVisualRuntimeClasses.size,
	embeddedStyleRuntimeFileCount: embeddedStyleRuntimeFiles.size,
	declaredFrontendSurfaceCount: surfaceContracts.length,
	frontendSurfaceEvidenceErrorCount: surfaceContractErrors.length,
	sourceOnlyCount: sourceOnly.length,
	cssOnlyCount: cssOnly.length,
	unownedCssClassCount: unownedCssClasses.length,
	referenceRuntimeOnlyCount: referenceRuntimeOnly.length,
	unscopedSelectorCount: unscopedSelectors.length,
	crossFileDuplicateSelectorCount: crossFileDuplicateSelectors.length,
	missingLayoutContractCount: missingLayoutContracts.length,
	sourceOnly: sourceOnly.slice(0, 120),
	cssOnly: cssOnly.slice(0, 120),
	unownedCssClasses: unownedCssClasses.slice(0, 120),
	referenceRuntimeOnly: referenceRuntimeOnly.slice(0, 120),
	uncoveredRuntimeClassGroups: uncoveredRuntimeClassGroups.slice(0, 80),
	unstyledRuntimeClasses: unstyledRuntimeClasses.slice(0, 160),
	unexpectedUnstyledRuntimeClasses:
		unexpectedUnstyledRuntimeClasses.slice(0, 160),
	staleNonVisualRuntimeClasses:
		staleNonVisualRuntimeClasses.slice(0, 160),
	surfaceContractErrors: surfaceContractErrors.slice(0, 80),
	crossFileDuplicateSelectors: crossFileDuplicateSelectors.slice(0, 80),
})}\n`);
