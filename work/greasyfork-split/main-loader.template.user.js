// ==UserScript==
// @name         Awesome LinuxDo Reader
// @name:zh-CN   更流畅的 LinuxDo 阅读器
// @namespace    https://github.com/sunbigfly/awesome-linuxdo-reader
// @version      0.1.16
// @license      MIT
// @description  为 LINUX DO 深度适配、全面兼容标准 Discourse 站点的沉浸式增强阅读器，支持长帖上下文、原站互动、非中文正文翻译、自定义站点与个性布局。
// @description:en Deeply adapted for LINUX DO and compatible with standard Discourse sites, with threaded reading, native interactions, body translation, custom sites, and personalized layouts.
// @author       sunbigfly
// @homepageURL  https://github.com/sunbigfly/awesome-linuxdo-reader
// @supportURL   https://github.com/sunbigfly/awesome-linuxdo-reader/issues
// @match        https://linux.do/*
// @match        https://community.brave.com/*
// @match        https://devforum.roblox.com/*
// @match        https://community.openai.com/*
// @match        https://community.home-assistant.io/*
// @match        https://forum.cfx.re/*
// @match        https://community.spiceworks.com/*
// @match        https://forum.arduino.cc/*
// @match        https://discussions.unity.com/*
// @match        https://community.cloudflare.com/*
// @match        https://forums.unrealengine.com/*
// @match        https://forum.obsidian.md/*
// @match        https://forum.cursor.com/*
// @match        https://forum.godotengine.org/*
// @match        https://community.n8n.io/*
// @match        https://forum.mikrotik.com/*
// @match        https://meta.discourse.org/*
// @match        https://discuss.python.org/*
// @match        https://forums.swift.org/*
// @match        https://discourse.julialang.org/*
// @match        https://users.rust-lang.org/*
// @match        https://*/*
// @icon         https://cdn3.ldstatic.com/optimized/4X/6/a/6/6a6affc7b1ce8140279e959d32671304db06d5ab_2_512x512.png
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_getResourceText
// @grant        unsafeWindow
// @connect      connect.linux.do
// @connect      credit.linux.do
// @connect      translate.googleapis.com
// @connect      edge.microsoft.com
// @connect      api-edge.cognitive.microsofttranslator.com
// @connect      *
// @run-at       document-start
// @resource     ldpReaderStyles https://cdn.jsdelivr.net/gh/sunbigfly/awesome-linuxdo-reader@6f32c5f548d440963c1c0abb2160908b609f5aec/work/main.css#sha256=0738f4c1470861e1c7fcf29db5b8cb76f788896740492e2a2fc760c90691ff7e
// @require      https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js
// @require      https://cdn.jsdelivr.net/npm/pinyin-pro@3.18.2/dist/index.js
// @require      https://cdn.jsdelivr.net/npm/hls.js@1.6.16/dist/hls.min.js
// build-release.cjs 会在下一行按需插入已发布的 Greasy Fork Library。
// __LDP_LIBRARY_REQUIREMENTS__
// ==/UserScript==


(function () {
	'use strict';

	const core = globalThis.AwesomeLinuxDoReaderCore;
	if (!core || core.schemaVersion !== 1 || core.sourceVersion !== '0.1.16') {
		throw new Error('[LDP] Reader Core 缺失或版本不匹配');
	}
	core.run();
})();
