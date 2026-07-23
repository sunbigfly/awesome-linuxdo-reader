---
title: 兼容性
description: 当前站点、脚本权限、浏览器能力、外部依赖和已知降级边界。
feature_ids: ["DATA-005", "REF-001"]
source_anchors: ["@grant", "@run-at"]
since: 0.1.2
version: 0.1.3
status: current
last_verified: 2026-07-23
screenshots: []
---

# 兼容性

## 当前支持范围

| 项目 | 当前值 |
| --- | --- |
| 脚本版本 | `0.1.3` |
| 匹配站点 | `https://linux.do/*` |
| 启动时机 | `document-start` |
| GM 权限 | `GM_xmlhttpRequest`、`unsafeWindow` |
| 跨域连接 | `connect.linux.do` |
| 外部依赖 | KaTeX 0.16.22、pinyin-pro 3.18.2、hls.js 1.6.16 |
| 发布渠道 | GreasyFork |

## 浏览器

阅读器依赖现代浏览器能力，包括 Shadow DOM、Fetch、AbortController、IntersectionObserver、ResizeObserver、MutationObserver、Cache Storage、IndexedDB 和部分 Performance API。

建议：

- 使用仍在安全支持期内的 Chromium、Firefox 或同等级浏览器；
- 允许脚本管理器访问 `https://linux.do/*`；
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
| 原站插件/权限 | 相应 Boost、Solved、指定、管理能力不出现 |

## 移动端

移动形态针对窄屏布局和触控操作，但 userscript 管理器、下载、文件导入和连续批量下载在移动浏览器中的支持差异较大。重要操作后应确认原站状态。

## 非兼容承诺

本项目不是 LINUX DO 官方客户端。原站 DOM、API、插件或安全策略变化可能先于阅读器适配。出现差异时可临时返回原生页面，并按[故障排查](/manage/troubleshooting)提交最小证据。
