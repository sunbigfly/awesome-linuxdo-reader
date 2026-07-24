---
title: 隐私、权限与边界
description: 理解 userscript 权限、外部依赖、本地存储、请求脱敏和账号数据边界。
feature_ids: ["DATA-004", "DATA-005", "MONITOR-005", "TROUBLE-005"]
source_anchors: ["PERSISTENT_CACHE_CONFIG", "@grant", "requestFlowPath", "@supportURL"]
since: 0.1.2
version: 0.1.4
status: current
last_verified: 2026-07-24
screenshots: ["/screenshots/guide-14-about.png"]
---

# 隐私、权限与边界

![关于面板中的版本、第三方组件、许可证和项目边界信息](/screenshots/guide-14-about.png)

<p class="image-caption">关于面板集中展示当前版本、第三方组件、许可证和项目入口；账号数据与互动结果仍以 LINUX DO 原站为准。</p>

## userscript 元数据

当前 `0.1.4`：

| 字段 | 值 | 用途 |
| --- | --- | --- |
| `@match` | `https://linux.do/*` | 只在 LINUX DO 页面运行 |
| `@grant` | `GM_xmlhttpRequest` | 获取允许的跨域公开资源 |
| `@grant` | `unsafeWindow` | 与 LINUX DO 页面运行时协作 |
| `@connect` | `connect.linux.do` | 访问 Connect 相关数据 |
| `@run-at` | `document-start` | 在 SPA 和页面初始化前建立必要边界 |

安装时脚本管理器会展示权限。若未来新增 GM API 或跨域目标，项目必须同步更新源码、功能目录和本页。

## 外部依赖

脚本从 jsDelivr 加载固定版本：

- KaTeX `0.16.22`；
- pinyin-pro `3.18.2`；
- hls.js `1.6.16`。

依赖不可用时，相应公式、拼音检索或 HLS 能力可能降级；普通文本阅读不应依赖这些增强全部成功。

## 本地数据

当前浏览器会保存设置、历史、主题快照、用户卡、消息分页、通用响应以及部分头像/图片。存储按账号作用域和数据类型隔离、有最大容量和保留期。

设置导出不包含历史、正文、API 响应、图片、Cookie 或账号凭据。

## 原站数据

阅读器不创建独立账号体系。回复、点赞、回应、收藏、通知级别、用户关系、举报和管理操作会调用原站能力。成功提示后若状态重要，应在网络恢复时再次确认。

## 监控数据

资源和请求监控只在当前标签页内存中保留有限时间。请求路径会去除查询参数，不记录 Cookie、授权头、正文或响应内容。

浏览器开发者工具、HAR、扩展后台日志可能包含更多敏感数据，不属于阅读器自身的脱敏保证。

## 截图与问题报告

发布前遮盖：

- 用户名、显示名称、头像；
- 私信、通知和帖子正文；
- 主题 ID、唯一楼层组合和账号统计；
- Cookie、Authorization、API key、响应正文；
- 能推断账号身份的自定义设置或历史。

安全问题按 [SECURITY.md](https://github.com/sunbigfly/awesome-linuxdo-reader/blob/main/SECURITY.md) 报告；普通问题使用 GitHub Issues。
