---
title: 设置中心总览
description: 理解 13 个设置面板、三种形态配置、共享字段、草稿与应用方式。
feature_ids: ["USER-005", "SET-001"]
source_anchors: ["renderSettingsUserInfo", "SETTINGS_PANEL_META", "READER_THEME_MODES"]
since: 0.1.2
version: 0.1.2
status: current
last_verified: 2026-07-23
screenshots: ["/screenshots/guide-02-settings-overview.png"]
---

# 设置中心总览

点击阅读器标题栏的“设置”进入设置中心。左侧导航包含 13 个面板：

| 面板 | 作用 |
| --- | --- |
| [用户信息](/settings/user-info) | 当前账号、社区统计、Connect 信任进度 |
| [图片设置](/settings/image) | 正文图片比例和灯箱默认行为 |
| [字体设置](/settings/font) | 渲染、宿主尺寸、界面/正文/回复字体 |
| [布局设置](/settings/layout) | 左留白、主帖、间距、时间轴和右留白 |
| [浮窗设置](/settings/window) | 浮窗宽高、坐标和编辑器窗口 |
| [外观设置](/settings/appearance) | 主题颜色、斑马纹、结构线和楼层预览 |
| [闪烁动效](/settings/motion) | 目标闪烁和等待区域动画 |
| [性能设置](/settings/performance) | 取数、DOM 窗口、楼中楼预取和请求调度 |
| [资源监控](/settings/resource-monitor) | 页面内存、长任务、DOM、媒体和网络趋势 |
| [请求数据](/settings/request-data) | 请求速率、排队、P95、异常和 429 |
| [其他功能](/settings/other) | 历史导航、打开位置、回复展示和 Boost 复制 |
| [数据管理](/settings/data-management) | 配置导入导出、恢复默认和缓存清理 |
| [关于](/settings/about) | 功能摘要、版本和项目入口 |

![设置中心完整导航、当前账号和 Connect 信任进度](/screenshots/guide-02-settings-overview.png)

## 三种配置形态

图片、字体、布局和外观支持：

- 浮窗；
- 全屏；
- 移动。

顶部标签决定你正在编辑哪一种形态，不会立即切换当前阅读器窗口。

## 按字段共享

链状按钮表示该字段是否跨三种形态共享：

- 开启共享后，一个值用于所有形态；
- 关闭后，浮窗、全屏和移动分别保存；
- 布局共享某一区域时，其余区域会自动平衡，合计始终为 100%；
- 草稿数量会显示在对应设置导航旁。

## 应用与即时保存

- 图片、字体、布局、浮窗和外观使用草稿，点击“确认应用”后生效。
- 明、暗、系统主题切换立即生效。
- 性能设置在下次打开阅读器时生效。
- 其他开关和数据管理操作按控件说明即时执行或显示确认。

## 设置窗口

桌面端可以拖动设置窗口标题区域。调整颜色或滑块时，设置中心会弱化其他项目，减少误操作。窄屏下导航改为横向区域，并保留上下/左右滚动提示。

## 阅读每个设置页

每个细分页面按相同顺序说明：

1. 从标题栏进入该面板的路径。
2. 每个控件控制什么，以及可选范围。
3. 修改是即时生效、确认应用，还是下次打开阅读器生效。
4. 浮窗、全屏和移动是否独立保存。
5. 常见状态、错误判断和回退方法。

需要快速查默认值时使用[完整设置参考](/settings/reference)；需要理解多项设置如何配合时使用“专题与参考”章节。
