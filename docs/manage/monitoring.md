---
title: 资源与请求监控
description: 阅读资源趋势、请求脉络、429 状态和 Cloudflare 恢复信息，并理解观测边界。
feature_ids: ["MONITOR-001", "MONITOR-002", "MONITOR-003", "MONITOR-004", "MONITOR-005"]
source_anchors: ["lite/src/monitor/reader-resource-monitor.ts","lite/src/app/reader-data-runtime.ts","lite/src/network/browser-shared-request-permit.ts","lite/src/network/request-observer.ts"]
since: 0.1.2
version: 1.5.1
status: current
last_verified: 2026-08-16
screenshots: ["/screenshots/guide-10-resource-monitor-v1.5.0.png", "/screenshots/guide-11-request-flow-v1.5.0.png"]
---

# 资源与请求监控

0.1.14 将两类观测合并为“设置 → 日志记录”，通过“请求记录”和“性能记录”标签切换。记录都只存在于当前页面内存，不会自动上传。

## 实时资源监控

每秒形成状态快照，展示：

| 指标 | 含义 |
| --- | --- |
| 页面内存估计 | 浏览器允许时的页面级估计，不能拆成单个脚本 |
| 最近 10 秒主线程卡顿 | 次数与累计耗时，包含原站与阅读器 |
| 阅读器页面元素 | 阅读器外壳内全部节点 |
| 楼层列表元素 | 当前显示与内存保留楼层 |
| 二级回复缓存 | 已建立回复状态的父楼层组 |
| 正文媒体元素 | 图片、音视频与内嵌页面 |
| 当前网络请求 | 进行中与排队 |
| 最近 60 秒网络 | 请求数与已知传输量 |

![资源监控中的基线、阅读器 DOM 和前后台事件](/screenshots/guide-10-resource-monitor-v1.5.0.png)

<p class="image-caption">在“设置 → 日志记录 → 性能记录”观察阅读器 DOM、长任务和前后台基线，用于判断趋势；数值不是 userscript 独占 CPU 或内存。</p>

面板还提供：

- 最近 60 秒前台/后台事件；
- 阅读器、原站/未标记、页面共享三种范围；
- 最近 10 分钟内存、DOM、保留楼层趋势；
- 毫秒级 Performance Timeline、Resource Timing、DOM 和可见性事件。

浏览器不会提供单个 userscript 的真实总 CPU 或独占内存。MutationRecord 没有原生时间戳，DOM 事件按观察器回调时状态记录。

## 请求记录

![请求速率、脉络、类型、异常和限流边界](/screenshots/guide-11-request-flow-v1.5.0.png)

<p class="image-caption">切换到“请求记录”查看请求类型、排队、异常与 429 冷却；先依据状态确认是站点限流、Cloudflare 还是本地队列，再决定等待或重试。</p>

摘要包含当前页：

- 10 秒和 60 秒请求数；
- 100 ms 峰值；
- 60 秒传输量；
- 60 秒异常数。

详细区域展示最近 10 秒排队/放行/网络脉络、主要瓶颈、异常点、按类型 P95 和毫秒请求记录。阅读器请求还显示贯穿重试的逻辑链、typed contract、缓存模式、安全 identity、单飞合并、优先级晋升、重试预算和最终决策。请求页可把当前完整脱敏账本、导出瞬间状态及采集期间调度/共享限流状态变化导出为 JSONL。

性能事件按毫秒时间分别记录类型、耗时或 DOM 增减、前后台、归因范围与浏览器依据；界面只显示最近事件，JSONL 导出保留内存中的十分钟样本、完整事件、前后台时间线、性能策略、关联脱敏请求，以及浏览器能力、观察器安装结果、数据来源、保留上限和淘汰计数。两类日志导出互相独立，不进入设置配置导出或 WebDAV。

## 来源与类型

来源分为阅读器、原站和浏览器资源。类型包括正文、二级回复、头像、媒体、用户资料、收藏、消息、实时通道、在线状态、回应、搜索、已读上报和静态资源。

原站 fetch/XHR 能纳入共享账本，但无法可靠确认脚本来源的活动保留为“原站/未标记”或“页面共享”，不会强行归因，也不会补造逻辑链或 typed contract。

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

遇到挑战时，阅读器在多个标签页之间协调一个验证窗口。验证成功后关闭窗口并逐步恢复速率；失败或被用户关闭时保留冷却，避免请求风暴。会话探针会进入 Reader 请求账本，并把“仍被盾拦截”与“已经过盾但接口仍返回普通 429”分开记录。

## 隐私

请求日志只保留经过处理的路径、查询键名及重复数量的形状、调用点和安全诊断字段，不保存查询值、Cookie、Authorization、请求正文或响应内容。敏感查询键会统一显示为 `credential`，安全 identity 只允许有限的非账号字段。提交截图时仍要检查路径是否包含主题 ID 或其他可关联信息。
