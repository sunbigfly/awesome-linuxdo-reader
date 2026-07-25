---
title: 兼容性
description: 当前站点、脚本权限、浏览器能力、外部依赖和已知降级边界。
feature_ids: ["CORE-007", "DATA-005", "REF-001"]
source_anchors: ["@grant", "@run-at", "DISCOURSE_SITE_ADAPTERS", "hasDiscourseCapability", "resolveSiteLogo"]
since: 0.1.2
version: 0.1.10
status: current
last_verified: 2026-07-25
screenshots: ["/screenshots/guide-01-reader-overview.png"]
---

# 兼容性

![现代 Chromium 浏览器中的 LINUX DO 列表页和增强阅读工作区](/screenshots/guide-01-reader-overview.png)

<p class="image-caption">桌面端浏览器可在保留宿主列表的同时运行增强阅读工作区；具体能力仍取决于浏览器、脚本管理器和站点权限。</p>

## 当前支持范围

| 项目 | 当前值 |
| --- | --- |
| 脚本版本 | `0.1.10` |
| 匹配站点 | 9 个明确列入 userscript 元数据的 Discourse 社区 |
| 启动时机 | `document-start` |
| GM 权限 | `GM_xmlhttpRequest`、`GM_getResourceText`、`unsafeWindow` |
| 跨域连接 | `connect.linux.do` |
| 外部依赖 | KaTeX 0.16.22、pinyin-pro 3.18.2、hls.js 1.6.16 |
| 发布渠道 | GreasyFork |

### 明确匹配的站点

| 社区 | 地址 | 覆盖说明 |
| --- | --- | --- |
| LINUX DO | `https://linux.do/*` | 完整功能与回归基线 |
| OpenAI Developer Community | `https://community.openai.com/*` | Discourse 核心能力，插件功能按站点检测 |
| Discourse Meta | `https://meta.discourse.org/*` | Discourse 核心能力，插件功能按站点检测 |
| Python Discussions | `https://discuss.python.org/*` | Discourse 核心能力，插件功能按站点检测 |
| Swift Forums | `https://forums.swift.org/*` | Discourse 核心能力，插件功能按站点检测 |
| Julia Discourse | `https://discourse.julialang.org/*` | Discourse 核心能力，插件功能按站点检测 |
| Home Assistant Community | `https://community.home-assistant.io/*` | Discourse 核心能力，插件功能按站点检测 |
| Arduino Forum | `https://forum.arduino.cc/*` | Discourse 核心能力，插件功能按站点检测 |
| Rust Users Forum | `https://users.rust-lang.org/*` | Discourse 核心能力，插件功能按站点检测 |

脚本启动后还会确认当前页面确实运行 Discourse。站点 Logo 从 Discourse 公开站点信息、宿主 Header 或页面图标中自动选择；图片不可用时继续尝试下一候选，不再依赖单一固定地址。

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
| 原站插件/权限 | Boost、Reactions、Post Voting、Solved、指定和管理等对应入口自动隐藏 |

## 移动端

移动形态针对窄屏布局和触控操作，但 userscript 管理器、下载、文件导入和连续批量下载在移动浏览器中的支持差异较大。重要操作后应确认原站状态。

## 非兼容承诺

本项目不是 LINUX DO 或其他适配社区的官方客户端。LINUX DO 保持完整覆盖目标；其他站点的 Discourse 版本、主题、插件和权限组合不同，个别能力可能自动降级。原站 DOM、API、插件或安全策略变化可能先于阅读器适配，出现差异时可临时返回原生页面，并按[故障排查](/manage/troubleshooting)提交最小证据。
