#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');

const ROOT = __dirname;
const PROJECT = JSON.parse(fs.readFileSync(path.join(ROOT, 'project.config.json'), 'utf8'));
const BUILD = JSON.parse(fs.readFileSync(path.join(ROOT, 'split-build.json'), 'utf8'));
const ASSETS = JSON.parse(fs.readFileSync(path.join(ROOT, 'reader-assets.json'), 'utf8'));
const results = [];

function sha256(value) {
	return crypto.createHash('sha256').update(value).digest('hex');
}

function check(condition, label, detail = '') {
	if (!condition) throw new Error(`${label}${detail ? `：${detail}` : ''}`);
	results.push({ check: label, detail });
}

function read(name) {
	return fs.readFileSync(path.join(ROOT, name));
}

for (const [name, entry] of Object.entries(BUILD.files)) {
	const value = read(name);
	check(value.byteLength === entry.bytes, `${name} 字节数`, String(value.byteLength));
	check(sha256(value) === entry.sha256, `${name} SHA-256`);
	if (entry.role !== 'standaloneSourceBaseline') {
		check(
			value.byteLength <= PROJECT.limits.projectExecutableCeiling,
			`${name} 低于项目执行文件闸门`,
			`${value.byteLength}/${PROJECT.limits.projectExecutableCeiling}`,
		);
	}
	if (name.endsWith('.js')) parser.parse(value.toString('utf8'), { sourceType: 'script' });
}

const standalone = read('main.user.js');
check(sha256(standalone) === ASSETS.source.sha256, 'JSON 资源来源哈希');
check(ASSETS.generation.staticDeclarationCount === 25, '静态资源声明数', '25');
check(Object.values(ASSETS.icons).reduce((sum, group) => sum + group.count, 0) === 108, 'SVG symbol 清单数', '108');

const svg = read('icons.svg').toString('utf8');
const symbolIds = [...svg.matchAll(/<symbol id="([^"]+)"/g)].map((match) => match[1]);
check(symbolIds.length === 108, 'SVG symbol 实际数', '108');
check(new Set(symbolIds).size === symbolIds.length, 'SVG symbol ID 唯一');
check(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[\s\S]*<\/svg>\s*$/.test(svg), 'SVG 外层结构');

const loader = read('main-loader.template.user.js').toString('utf8');
check(loader.split('// __LDP_LIBRARY_REQUIREMENTS__').length === 2, '主脚本 Library 插槽唯一');
check(loader.includes('AwesomeLinuxDoReaderCore'), '主脚本 Core 契约');
check(PROJECT.policy.libraryStrategy === 'on-demand', '按需多 Library 策略');

console.log(JSON.stringify({
	ok: true,
	sourceVersion: PROJECT.sourceVersion,
	checks: results,
}, null, 2));
