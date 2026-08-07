---
title: 兼容性
description: LINUX DO 全面适配、中英文及其他语言 Discourse 站点通用、正文翻译以及插件能力降级边界。
feature_ids: ["CORE-007", "DATA-005", "REF-001"]
source_anchors: ["lite/src/app/reader-application.ts","lite/src/userscript/browser-userscript-environment.ts","lite/userscript.meta.txt"]
since: 0.1.2
version: 1.1.0
status: current
last_verified: 2026-08-08
screenshots: ["/screenshots/guide-01-reader-overview-v1.0.0.png"]
---

# 兼容性

![现代 Chromium 浏览器中的 LINUX DO 列表页和增强阅读工作区](/screenshots/guide-01-reader-overview-v1.0.0.png)

<p class="image-caption">桌面端浏览器可在保留宿主列表的同时运行增强阅读工作区；具体能力仍取决于浏览器、脚本管理器和站点权限。</p>

LINUX DO 是完整功能与真实回归基线。中文、英文及其他语言的标准 Discourse 站点均可适配；脚本会先验证站点身份，再根据当前版本、主题、权限以及 Boost、Reactions、Post Voting 等插件能力显示可用入口。缺少插件时自动降级，不影响长帖阅读、楼层上下文和原站基础互动。

## 当前支持范围

| 项目 | 当前值 |
| --- | --- |
| 脚本版本 | `1.1.0` |
| 匹配站点 | LINUX DO 全面适配；20 个其他社区内置支持；其余标准 HTTPS Discourse 站点可验证后添加 |
| 启动时机 | `document-start` |
| GM 权限 | `GM_getValue`、`GM_setValue`、`GM_xmlhttpRequest`、`GM_getResourceText`、`unsafeWindow` |
| 跨域连接 | `connect.linux.do`、`credit.linux.do`、用户输入站点的 `/site/basic-info.json`、用户配置的 HTTPS WebDAV、Google / Microsoft 翻译接口；元数据以 `@connect *` 承载动态目标，业务端口仍按固定用途收窄 |
| 外部依赖 | KaTeX 0.16.22、pinyin-pro 3.18.2、hls.js 1.6.16 |
| 发布渠道 | GreasyFork |

### 明确匹配的站点

| 社区 | 地址 | 覆盖说明 |
| --- | --- | --- |
| LINUX DO | `https://linux.do/*` | 完整功能与回归基线 |
| Brave Community | `https://community.brave.com/*` | Discourse 核心能力，插件功能按站点检测 |
| Roblox Developer Forum | `https://devforum.roblox.com/*` | Discourse 核心能力，插件功能按站点检测 |
| OpenAI Developer Community | `https://community.openai.com/*` | Discourse 核心能力，插件功能按站点检测 |
| Home Assistant Community | `https://community.home-assistant.io/*` | Discourse 核心能力，插件功能按站点检测 |
| Cfx.re Forum | `https://forum.cfx.re/*` | Discourse 核心能力，插件功能按站点检测 |
| Spiceworks Community | `https://community.spiceworks.com/*` | Discourse 核心能力，插件功能按站点检测 |
| Arduino Forum | `https://forum.arduino.cc/*` | Discourse 核心能力，插件功能按站点检测 |
| Unity Discussions | `https://discussions.unity.com/*` | Discourse 核心能力，插件功能按站点检测 |
| Cloudflare Community | `https://community.cloudflare.com/*` | Discourse 核心能力，插件功能按站点检测 |
| Epic Developer Community | `https://forums.unrealengine.com/*` | Discourse 核心能力，插件功能按站点检测 |
| Obsidian Forum | `https://forum.obsidian.md/*` | Discourse 核心能力，插件功能按站点检测 |
| Cursor Community | `https://forum.cursor.com/*` | Discourse 核心能力，插件功能按站点检测 |
| Godot Forum | `https://forum.godotengine.org/*` | Discourse 核心能力，插件功能按站点检测 |
| n8n Community | `https://community.n8n.io/*` | Discourse 核心能力，插件功能按站点检测 |
| MikroTik Forum | `https://forum.mikrotik.com/*` | Discourse 核心能力，插件功能按站点检测 |
| Discourse Meta | `https://meta.discourse.org/*` | Discourse 核心能力，插件功能按站点检测 |
| Python Discussions | `https://discuss.python.org/*` | Discourse 核心能力，插件功能按站点检测 |
| Swift Forums | `https://forums.swift.org/*` | Discourse 核心能力，插件功能按站点检测 |
| Julia Discourse | `https://discourse.julialang.org/*` | Discourse 核心能力，插件功能按站点检测 |
| Rust Users Forum | `https://users.rust-lang.org/*` | Discourse 核心能力，插件功能按站点检测 |

脚本同时声明 `https://*/*`，以便用户保存的自定义域名能够启动；未命中内置列表或用户列表时会在业务初始化前退出。添加自定义站点时会匿名请求该域名的 `/site/basic-info.json`，只有检测到 Discourse 站点信息才保存。站点 Logo 从 Discourse 公开站点信息、宿主 Header 或页面图标中自动选择。

站点适配不限制内容语言。正文翻译对非中文内置社区和语言未知的自定义 Discourse 站点开放，译文目标为简体中文；LINUX DO 作为内置中文站点隐藏翻译入口。Google / Microsoft 翻译接口不可用时，原文阅读不受影响。

## 浏览器

阅读器依赖现代浏览器能力，包括 Shadow DOM、Fetch、AbortController、IntersectionObserver、ResizeObserver、MutationObserver、Cache Storage、IndexedDB 和部分 Performance API。

建议：

- 使用仍在安全支持期内的 Chromium、Firefox 或同等级浏览器；
- 允许脚本管理器访问当前使用的匹配站点；
- 不要同时运行两个阅读器版本；
- 在隐私模式中确认脚本管理器和站点存储是否被允许。

## 能力降级

| 不可用能力 | 影响 |
| --- | --- |
| Cache Storage / IndexedDB | 缓存减少，更多内容需要联网重新获取 |
| PerformanceObserver 某些条目 | 资源监控显示较少证据，不影响基本阅读 |
| 浏览器内存 API | 不显示页面内存估计 |
| hls.js 或媒体编码 | HLS/特定媒体不能播放 |
| KaTeX | 公式不能增强渲染 |
| pinyin-pro | 依赖拼音的检索辅助降级 |
| Google / Microsoft 翻译接口 | 正文翻译提示失败，原文继续可读 |
| WebDAV 服务、权限或 ETag | 本轮同步提示失败并保留本机记录，普通阅读不受影响 |
| 原站插件/权限 | Boost、Reactions、Post Voting、Solved、指定和管理等对应入口自动隐藏 |

## 移动端

移动形态针对窄屏布局和触控操作，但 userscript 管理器、下载、文件导入和连续批量下载在移动浏览器中的支持差异较大。重要操作后应确认原站状态。

## 非兼容承诺

本项目不是 LINUX DO 或其他适配社区的官方客户端。LINUX DO 保持完整覆盖目标；其他站点的 Discourse 版本、主题、插件和权限组合不同，个别能力可能自动降级。原站 DOM、API、插件或安全策略变化可能先于阅读器适配，出现差异时可临时返回原生页面，并按[故障排查](/manage/troubleshooting)提交最小证据。
