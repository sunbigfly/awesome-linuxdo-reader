// ==UserScript==
// @name         Awesome LinuxDo Reader
// @name:zh-CN   更流畅的 LinuxDo 阅读器
// @namespace    https://github.com/sunbigfly/awesome-linuxdo-reader
// @version      1.5.4
// @license      MIT
// @description  为 LINUX DO 深度定制并保持完整功能覆盖，同时通过站点识别与能力检测兼容中文、英文及其他语言的标准 Discourse 社区，在列表页内完成阅读、翻译、回复与原站互动。
// @description:en Deeply customized for LINUX DO with complete feature coverage, while site detection and capability checks support standard Discourse communities in any language for in-list reading, translation, replies, and native interactions.
// @author       sunbigfly
// @homepageURL  https://sunbigfly.github.io/awesome-linuxdo-reader/
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
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
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
// @resource     ldpReaderStyles https://cdn.jsdelivr.net/gh/sunbigfly/awesome-linuxdo-reader@25fb1508884e8e524e381c1a7942e9729f41d52d/work/main-lite.css#sha256=1bce472ab2eecf03f62579975724661d11c8e1839b13cb837c92ae2edbe2f40d
// @resource     ldpKatexStyles https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css
// @require      https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js
// @require      https://cdn.jsdelivr.net/npm/pinyin-pro@3.18.2/dist/index.js
// @require      https://cdn.jsdelivr.net/npm/hls.js@1.6.16/dist/hls.min.js
// @require      https://update.greasyfork.org/scripts/590254/1905010/Awesome%20LinuxDo%20Reader%20Lite%20Core%20Library.js?version=1905010#sha256=3fa3487b444baf95ab951e2a98296d0822a1fd49f4ab4b932ab28473c86429db
// @require      https://update.greasyfork.org/scripts/591595/1905012/Awesome%20LinuxDo%20Reader%20Lite%20Platform%20Library.js?version=1905012#sha256=fe3451175591ba4e283a347064538c6bba95e0b8bceb9d513c259cb3be25706a
// @require      https://update.greasyfork.org/scripts/590255/1905011/Awesome%20LinuxDo%20Reader%20Lite%20Features%20Library.js?version=1905011#sha256=f7ec6a944e15e1f065ff26c1f7f36420514eaf5dc5b5455d18af5265a29f2d29
// ==/UserScript==

(function () {
	'use strict';
	const runtime = window.__AWESOME_LINUXDO_READER_LITE_MODULE_RUNTIME__;
	if (!runtime || runtime.schemaVersion !== 1 ||
		runtime.sourceVersion !== "1.5.4") {
		throw new Error('[main-lite] Greasy Fork Library 缺失或版本不匹配');
	}
	runtime.start("src/userscript/main-lite-entry.js", ["main-lite-core","main-lite-platform","main-lite-features"]);
})();
