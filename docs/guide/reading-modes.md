---
title: 阅读模式与工作区
description: 选择浮窗、全屏、嵌入或移动布局，理解多主题队列和虚拟阅读流。
feature_ids: ["CORE-003", "CORE-004", "CORE-005", "CORE-006", "READ-001", "READ-002"]
source_anchors: ["INITIAL_TOPIC_ID", "LIST_READER_MODES", "bypassReaderForThisTab", "LDP_READER_QUEUE_KEY", "stableStreamMountRange", "loadPostsByIds"]
since: 0.1.2
version: 0.1.3
status: current
last_verified: 2026-07-24
screenshots: ["/screenshots/guide-01-reader-overview.png", "/screenshots/guide-05-layout-settings.png", "/screenshots/guide-09-performance-settings.png"]
---

# 阅读模式与工作区

## 选择显示形态

| 形态 | 适合场景 | 行为 |
| --- | --- | --- |
| 浮窗 | 单主题精读、保留宿主背景 | 可拖动、缩放并记住位置；最小宽 360 px、最小高 320 px |
| 全屏 | 长帖、媒体和复杂上下文 | 使用完整视口，按全屏配置应用图片、字体、布局和外观 |
| 左侧嵌入 | 阅读器在左、列表在右 | 两区同时可操作；桌面宽屏更合适 |
| 右侧嵌入 | 列表在左、阅读器在右 | 适合边筛选主题边阅读 |
| 移动 | 窄屏、触控设备或纵向窗口 | 使用移动配置和紧凑控件，减少横向依赖 |

主题原始路由只使用浮窗接管；列表页可以切换浮窗、全屏和左右嵌入。布局按钮的实际可用项会随当前路由和窗口宽度变化。

![三种配置形态和五区比例设置](/screenshots/guide-05-layout-settings.png)

## 多主题阅读队列

阅读队列允许从列表页提前加入多个主题，在同一个工作区内切换，并为非当前主题后台准备正文、楼中楼和相关图片。队列会保存阅读位置、固定状态与浮层位置；刷新后仍可恢复。

完整的入口、状态说明、预加载边界、键盘操作和故障恢复见[阅读队列](/guide/reading-queue)。

## 长帖为什么不会越读越重

阅读器把“数据已经获取”和“节点正在 DOM 中挂载”分开：

1. 接近数据边缘时，按设置中的“每批请求主楼层”补充数据。
2. 只在视口前后保留一定屏数的节点。
3. 超出挂载上限的远处楼层卸载，必要时保留高度占位。
4. 回到相应位置时从内存或缓存重新渲染。

![主楼层批量、DOM 窗口和挂载上限设置](/screenshots/guide-09-performance-settings.png)

因此，快速跳楼时可能短暂看到等待区域；这通常表示数据或节点正在补齐，不等同于丢失阅读位置。

## 临时返回原生页面

标题栏的原生页面入口可绕过当前标签页的阅读器接管。适合以下情况：

- 原站刚上线新交互，阅读器尚未适配；
- 需要对比原站呈现；
- 某个管理能力只在原生页面可用；
- 你正在排查是否由 userscript 引起问题。

返回增强阅读时，使用普通主题链接或列表页阅读器入口。
