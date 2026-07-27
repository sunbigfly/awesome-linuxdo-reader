#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');

const ROOT = __dirname;
const SOURCE_PATH = path.join(ROOT, 'main.user.js');
const ASSETS_PATH = path.join(ROOT, 'reader-assets.json');
const ICONS_PATH = path.join(ROOT, 'icons.svg');

const RESOURCE_GROUPS = Object.freeze({
	templates: [
		'READER_LOADING_ANIMATIONS',
		'BOOST_COPY_SETTING_ROWS',
	],
	copy: [
		'NOTIFICATION_GROUPS',
		'SYSTEM_ACTION_LABELS',
		'READER_REPORT_COPY',
		'REQUEST_FLOW_TYPE_LABELS',
	],
	config: [
		'READER_THEME_VALUE_ROWS',
		'PERFORMANCE_SETTING_GROUPS',
		'HOST_EMBED_SIZE_SETTINGS',
		'FONT_FAMILY_OPTIONS',
		'FONT_SCOPE_CONFIG',
		'APPEARANCE_COLOR_THEME_LIMITS',
		'APPEARANCE_PROFILE_SETTING_KEYS',
		'READER_PRESENTATIONS',
		'NOTIFICATION_TYPE_ICONS',
		'CACHE_TYPES',
		'APPEARANCE_SETTING_GROUPS',
		'RESOURCE_MONITOR_ROWS',
		'REQUEST_FLOW_RESPONSE_HEADERS',
		'DISCOURSE_CAPABILITY_FIELDS',
		'USER_CARD_BADGE_EXACT_KINDS',
		'POST_CONTEXT_ACTIONS',
		'JUMP_HIGHLIGHT_LIMITS',
	],
});

const ICON_GROUPS = Object.freeze({
	ICONS: 'ldp-icon-',
	USER_CARD_BADGE_GLYPHS: 'ldp-badge-',
});

function walk(node, visit) {
	if (!node || typeof node !== 'object') return;
	if (typeof node.type === 'string') visit(node);
	for (const [key, value] of Object.entries(node)) {
		if (['loc', 'start', 'end', 'extra', 'errors', 'comments', 'tokens'].includes(key)) continue;
		if (Array.isArray(value)) {
			for (const item of value) walk(item, visit);
		} else {
			walk(value, visit);
		}
	}
}

function unwrapFreeze(node) {
	if (
		node?.type === 'CallExpression'
		&& node.arguments.length === 1
		&& node.callee.type === 'MemberExpression'
		&& node.callee.object.type === 'Identifier'
		&& node.callee.object.name === 'Object'
		&& node.callee.property.type === 'Identifier'
		&& node.callee.property.name === 'freeze'
	) {
		return node.arguments[0];
	}
	return node;
}

function propertyName(node) {
	if (node.type === 'Identifier' || node.type === 'StringLiteral' || node.type === 'NumericLiteral') {
		return String(node.name ?? node.value);
	}
	throw new Error(`不支持的对象键类型：${node.type}`);
}

function literalValue(inputNode) {
	const node = unwrapFreeze(inputNode);
	if (!node) throw new Error('资源值为空');
	switch (node.type) {
		case 'StringLiteral':
		case 'NumericLiteral':
		case 'BooleanLiteral':
			return node.value;
		case 'NullLiteral':
			return null;
		case 'TemplateLiteral':
			if (node.expressions.length) throw new Error('模板字符串包含动态表达式');
			return node.quasis[0].value.cooked;
		case 'UnaryExpression': {
			const value = literalValue(node.argument);
			if (node.operator === '-') return -value;
			if (node.operator === '+') return +value;
			throw new Error(`不支持的一元运算符：${node.operator}`);
		}
		case 'ArrayExpression':
			return node.elements.map((item) => item === null ? null : literalValue(item));
		case 'ObjectExpression': {
			const result = {};
			for (const property of node.properties) {
				if (property.type !== 'ObjectProperty' || property.computed || property.shorthand) {
					throw new Error(`对象包含非静态属性：${property.type}`);
				}
				result[propertyName(property.key)] = literalValue(property.value);
			}
			return result;
		}
		default:
			throw new Error(`不支持的资源节点：${node.type}`);
	}
}

function collectDeclarations(ast) {
	const declarations = new Map();
	walk(ast, (node) => {
		if (node.type !== 'VariableDeclarator' || node.id.type !== 'Identifier') return;
		if (declarations.has(node.id.name)) return;
		declarations.set(node.id.name, node);
	});
	return declarations;
}

function requireDeclaration(declarations, name) {
	const declaration = declarations.get(name);
	if (!declaration?.init) throw new Error(`找不到静态常量：${name}`);
	return declaration;
}

function buildAssets(source, declarations, version) {
	const output = {
		schemaVersion: 1,
		sourceVersion: version,
		source: {
			file: 'main.user.js',
			bytes: Buffer.byteLength(source),
			sha256: crypto.createHash('sha256').update(source).digest('hex'),
		},
		generation: {
			staticDeclarationCount: 0,
			staticDeclarationBytes: 0,
			note: '字节数为候选声明初始值的毛收益，尚未扣除资源加载与访问代码。',
		},
		templates: {},
		copy: {},
		config: {},
		icons: {},
	};
	for (const [group, names] of Object.entries(RESOURCE_GROUPS)) {
		for (const name of names) {
			const declaration = requireDeclaration(declarations, name);
			output[group][name] = literalValue(declaration.init);
			output.generation.staticDeclarationCount += 1;
			output.generation.staticDeclarationBytes += Buffer.byteLength(
				source.slice(declaration.init.start, declaration.init.end),
			);
		}
	}
	return output;
}

function buildIcons(declarations, assets) {
	const lines = [
		'<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true">',
		'\t<defs>',
	];
	for (const [name, prefix] of Object.entries(ICON_GROUPS)) {
		const declaration = requireDeclaration(declarations, name);
		const object = unwrapFreeze(declaration.init);
		if (object.type !== 'ObjectExpression') throw new Error(`${name} 不是静态对象`);
		let count = 0;
		lines.push(`\t\t<!-- ${name} -->`);
		for (const property of object.properties) {
			if (property.type !== 'ObjectProperty' || property.computed || property.shorthand) {
				throw new Error(`${name} 包含非静态属性`);
			}
			const key = propertyName(property.key);
			const markup = literalValue(property.value);
			if (typeof markup !== 'string') throw new Error(`${name}.${key} 不是字符串`);
			lines.push(`\t\t<symbol id="${prefix}${key}" viewBox="0 0 24 24">${markup}</symbol>`);
			count += 1;
		}
		assets.icons[name] = {
			count,
			idPrefix: prefix,
		};
		assets.generation.staticDeclarationCount += 1;
		assets.generation.staticDeclarationBytes += Buffer.byteLength(
			source.slice(declaration.init.start, declaration.init.end),
		);
	}
	lines.push('\t</defs>', '</svg>', '');
	return lines.join('\n');
}

const source = fs.readFileSync(SOURCE_PATH, 'utf8');
const versionMatch = source.match(/^\s*\/\/\s*@version\s+([^\s]+)\s*$/m);
if (!versionMatch) throw new Error('userscript 元数据缺少 @version');
const ast = parser.parse(source, { sourceType: 'script' });
const declarations = collectDeclarations(ast);
const assets = buildAssets(source, declarations, versionMatch[1]);
const icons = buildIcons(declarations, assets);

fs.writeFileSync(ICONS_PATH, icons, 'utf8');
fs.writeFileSync(ASSETS_PATH, `${JSON.stringify(assets, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
	sourceVersion: assets.sourceVersion,
	sourceBytes: assets.source.bytes,
	staticDeclarationCount: assets.generation.staticDeclarationCount,
	staticDeclarationBytes: assets.generation.staticDeclarationBytes,
	assetBytes: Buffer.byteLength(JSON.stringify(assets)),
	iconBytes: Buffer.byteLength(icons),
	iconCount: Object.values(assets.icons).reduce((sum, group) => sum + group.count, 0),
}, null, 2));
