---
title: 故障排查
description: 按安装、打开、跳楼、图片、429、配置和缓存分类排查常见问题。
feature_ids: ["CORE-005", "MEDIA-013", "DATA-003", "MONITOR-003", "MONITOR-004", "TROUBLE-001", "TROUBLE-002", "TROUBLE-003", "TROUBLE-004", "TROUBLE-005"]
source_anchors: ["bypassReaderForThisTab", "showReaderImageRetry", "clearCurrentTopicCaches", "READER_ENDPOINT_429_BASE_BLOCK_MS", "LDP_CLOUDFLARE_CHALLENGE_LEASE_KEY", "@match", "unavailablePostNumbers", "LIGHTBOX_IMAGE_RESOURCE_REQUESTS", "replacePrefsAndReload", "@supportURL"]
since: 0.1.2
version: 0.1.2
status: current
last_verified: 2026-07-23
screenshots: ["/screenshots/guide-19-image-lightbox.png", "/screenshots/guide-11-request-flow.png", "/screenshots/guide-13-data-management.png"]
---

# 故障排查

## 快速分流

| 现象 | 优先检查 |
| --- | --- |
| 没有阅读器入口 | 脚本启用、站点匹配、刷新、重复脚本 |
| 主题打不开 | 原生页面是否可打开、请求数据、当前主题缓存 |
| 跳不到楼层 | 过滤状态、目标是否删除、虚拟窗口是否仍在补齐 |
| 图片打不开 | 预览是否存在、原图源、来源楼层、资源缓存 |
| 持续 429 | 请求数据、端点冷却、性能预设、Cloudflare |
| 设置异常 | 先导出，再按范围重置 |
| 页面卡顿 | DOM 数量、媒体、长任务、当前性能设置 |

## 入口没有出现

1. 地址必须匹配 `https://linux.do/*`。
2. 确认脚本和站点访问权限已启用。
3. 安装/更新后完整刷新。
4. 停用重复的正式版、本地版或同类接管脚本。
5. 从脚本管理器确认版本为 `0.1.2`。

## 主题或楼层无法加载

先用标题栏入口打开原生页面：

- 原生页面也失败：更可能是权限、网络、帖子删除或站点状态。
- 原生正常、阅读器失败：查看“请求数据”的异常和排队原因。

目标楼层 404/410 时，阅读器把它记为当前会话不可用，避免反复请求。只看楼主或其他筛选可能隐藏目标；消息跳转会尝试解除不兼容过滤。

若仅一个主题异常，使用“数据管理”清理当前主题缓存，而不是清空全部历史。

## 图片和媒体

![灯箱保留预览、原图和关联评论入口](/screenshots/guide-19-image-lightbox.png)

- 预览能看、原图失败：原图地址可能过期、受权限限制或被跨域阻止。
- 来源楼层 404：已有 CDN 图片仍可能可用，不应无限重试来源。
- HLS 失败：检查浏览器编码支持、媒体服务器和网络策略。
- 公式缺失：检查 KaTeX 外部依赖是否加载。

清理“头像与图片”缓存后重新打开；这不会删除线上图片。

## 429 和 Cloudflare

![请求数据面板中的异常、排队和恢复状态](/screenshots/guide-11-request-flow.png)

1. 不要连续刷新或重复点击加载。
2. 切回“均衡”或“省资源”。
3. 等待请求数据面板显示冷却结束。
4. 若出现 Cloudflare 验证窗口，在唯一窗口内完成验证。
5. 验证成功后让阅读器逐步恢复，不要立刻开多个长帖。

单个端点异常会独立冷却；若所有请求都慢，检查全局窗口或宿主请求活动。

## 配置恢复

![配置导出、导入、恢复默认和缓存清理](/screenshots/guide-13-data-management.png)

顺序：

1. 导出当前设置。
2. 只重置相关设置组或清理相关缓存。
3. 刷新并复现。
4. 最后才使用“恢复全部默认”。

恢复默认会覆盖阅读器设置，但不会删除原站账号数据。

## 提交有效问题报告

包含：

- 浏览器、脚本管理器和脚本版本；
- 页面类型与路径，不含私密查询参数；
- 最短复现步骤；
- 预期和实际结果；
- 请求数据中的状态、类型和排队原因；
- 已脱敏截图。

不要包含 Cookie、Authorization、私信/通知正文、完整 API 响应或可识别账号信息。
