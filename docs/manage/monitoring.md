---
title: 资源与请求监控
description: 阅读资源趋势、请求脉络、429 状态和 Cloudflare 恢复信息，并理解观测边界。
feature_ids: ["MONITOR-001", "MONITOR-002", "MONITOR-003", "MONITOR-004", "MONITOR-005"]
source_anchors: ["RESOURCE_MONITOR_ROWS", "REQUEST_FLOW_MAX_ENTRIES", "READER_ENDPOINT_429_BASE_BLOCK_MS", "LDP_CLOUDFLARE_CHALLENGE_LEASE_KEY", "requestFlowPath"]
since: 0.1.2
version: 0.1.2
status: current
last_verified: 2026-07-23
screenshots: ["/screenshots/guide-10-resource-monitor.png", "/screenshots/guide-11-request-flow.png"]
---

# 资源与请求监控

两个面板都是当前页面内的临时观测工具，不会自动上传记录。

## 实时资源监控

每秒形成状态快照，展示：

| 指标 | 含义 |
| --- | --- |
| 页面内存估计 | 浏览器允许时的页面级估计，不能拆成单个脚本 |
| 10 秒共享长任务 | 主线程长任务次数与累计时长 |
| 阅读器 DOM | 阅读器外壳内全部节点 |
| 主楼层 DOM | 已挂载与内存保留楼层 |
| 楼中楼缓存 | 已建立状态的父楼层组 |
| 正文媒体 DOM | 图片、音视频与 iframe |
| 当前阅读器请求 | 执行中与排队 |
| 60 秒阅读器网络 | 请求数与已知传输量 |

![资源监控中的基线、阅读器 DOM 和前后台事件](/screenshots/guide-10-resource-monitor.png)

面板还提供：

- 最近 60 秒前台/后台事件；
- 阅读器、宿主/未标记、页面共享三种范围；
- 最近 10 分钟内存、DOM、保留楼层趋势；
- 毫秒级 Performance Timeline、Resource Timing、DOM 和可见性事件。

浏览器不会提供单个 userscript 的真实总 CPU 或独占内存。MutationRecord 没有原生时间戳，DOM 事件按观察器回调时状态记录。

## 请求数据

![请求速率、脉络、类型、异常和限流边界](/screenshots/guide-11-request-flow.png)

摘要包含当前页：

- 10 秒和 60 秒请求数；
- 100 ms 峰值；
- 60 秒传输量；
- 60 秒异常数。

详细区域展示最近 10 秒排队/放行/网络脉络、主要瓶颈、异常点、按类型 P95 和毫秒请求记录。

## 来源与类型

来源分为阅读器、宿主和浏览器资源。类型包括正文、楼中楼、头像、媒体、用户资料、收藏、消息、实时通道、在线状态、回应、搜索、已读上报和静态资源。

宿主 fetch/XHR 能纳入共享账本，但无法可靠确认脚本来源的活动保留为“宿主/未标记”或“页面共享”，不会强行归因。

## 429 与排队原因

常见等待原因：

- 优先级；
- 并发槽；
- 启动间隔；
- 10 秒或 60 秒窗口；
- 全局 429 退避；
- 单端点冷却。

LINUX DO 可覆盖 Discourse 默认限流，搜索、发帖、私信和插件也可能有独立边界。面板中的公开数字只是风险刻度，实际以 `429`、`Retry-After` 和错误码为准。

## Cloudflare 验证

遇到挑战时，阅读器在多个标签页之间协调一个验证窗口。验证成功后关闭窗口并逐步恢复速率；失败或被用户关闭时保留冷却，避免请求风暴。

## 隐私

请求日志只保留经过处理的路径和调用点，不保存查询参数、Cookie、Authorization、请求正文或响应内容。提交截图时仍要检查路径是否包含主题 ID 或其他可关联信息。
