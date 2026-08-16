---
title: 设置中心总览
description: 理解 18 个设置面板、分组导航、安全配置管理、WebDAV 同步、三种形态配置与统一保存方式。
feature_ids: ["USER-005", "SET-001", "SET-020", "SET-022", "DATA-001", "DATA-006", "DATA-007"]
source_anchors: ["lite/src/user/discourse-native-user-port.ts","lite/src/state/reader-preferences-schema.ts","lite/src/appearance/reader-theme-controller.ts","lite/src/appearance/reader-local-sun-clock.ts","lite/src/settings/reader-settings-controller.ts","lite/src/settings/reader-ai-service-settings-form.ts","lite/src/settings/reader-translation-settings-form.ts","lite/src/settings/reader-shortcut-settings-form.ts","lite/src/shell/reader-shortcut-controller.ts","lite/src/settings/reader-webdav-settings-form.ts","lite/src/state/reader-settings-config-manager.ts"]
since: 0.1.2
version: 1.5.0
status: current
last_verified: 2026-08-16
screenshots: ["/screenshots/guide-02-settings-overview-v1.5.0.png"]
---

# 设置中心总览

点击阅读器标题栏的“设置”进入设置中心。当前 v1.5.0 按“显示与布局”“阅读与交互”“系统与数据”分组，共包含 18 个面板：

| 面板 | 作用 |
| --- | --- |
| [用户信息](/settings/user-info) | 当前账号、社区统计、Connect 信任进度和 LDC 账户数据 |
| [图片设置](/settings/image) | 正文图片大小和大图查看器默认行为 |
| [字体设置](/settings/font) | 字体显示优化、原站列表尺寸和界面/正文/回复字体 |
| [布局设置](/settings/layout) | 左右留白、正文区域、时间轴和两者间距 |
| [浮窗设置](/settings/window) | 浮窗宽高、位置、保持显示和锁定 |
| [外观设置](/settings/appearance) | 明暗主题、当地日落自动暗色、颜色、关系线、分隔线和预览卡片 |
| [动画与提示](/settings/motion) | 跳转楼层提示和帖子加载动画 |
| [阅读与导航](/settings/other) | 队列入口、历史导航、帖子打开位置和退出方式 |
| [翻译设置](/guide/content-and-media#跨语正文翻译) | 译文样式、动画、按供应商分组的翻译模型，以及温度、限额和翻译 Prompt |
| [AI 服务](/settings/reference#ai-服务) | 供翻译、帖子总结等功能共用的 OpenAI 兼容 API URL、Key 与缓存模型目录 |
| [快捷方式](/settings/other#快捷方式) | 为浏览导航、阅读工具、面板、帖子操作、窗口和队列绑定键盘或鼠标操作 |
| [帖子与回复](/settings/other) | 主帖操作列、二级回复显示位置和 Boost 复制 |
| [适用站点](/settings/other) | 添加并管理其他 HTTPS Discourse 论坛 |
| [性能设置](/settings/performance) | 楼层加载、页面保留范围、二级回复预加载和请求节奏 |
| [日志记录](/settings/request-data) | 在请求记录和性能记录之间切换 |
| [数据管理](/settings/data-management) | 安全导入导出、恢复默认和缓存清理 |
| [WebDAV 同步](/settings/webdav-sync) | 跨设备合并所选记录，并可单独同步离线 Topic HTML |
| [关于](/settings/about) | 功能摘要、版本和项目入口 |

![设置中心完整导航、当前账号和 Connect 信任进度](/screenshots/guide-02-settings-overview-v1.5.0.png)

<p class="image-caption">从阅读器标题栏进入设置中心，可搜索并切换三组、18 个面板；统一保存负责当前设置，WebDAV、缓存清理和恢复默认仍是各自独立的确认流程。</p>

## 分组与搜索

- 桌面端导航按三组排列，滚动条替代旧的上下翻页按钮；窄屏仍使用横向导航。
- 进入用户信息之外的设置页后，顶部会出现“搜索设置”输入框。
- 搜索会匹配面板名称、设置标题、说明和常用功能词，并隐藏无关面板；清空搜索即可恢复全部项目。
- 搜索结果为空时只显示空状态，不会删除、重置或保存任何设置。

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

## 统一保存与即时设置

- 图片、字体、布局、浮窗、外观和跳转提示中的草稿会实时预览。
- 任一设置页产生草稿后，面板底部出现“保存全部更改”，同时显示未保存数量和涉及分类。
- 点击一次即可提交全部草稿；若五区布局合计不是 100%，保存会停止并引导返回布局页。
- 明、暗、系统主题切换立即生效；自动暗色可按当地日落或固定时间进入暗色，并在日出恢复先前模式。
- 性能设置统一保存后立即投到当前与后续帖子；已启动的请求自然完成，固定请求安全规则不受设置覆盖。
- 阅读、快捷方式、交互、站点开关和数据管理操作按控件说明即时执行或显示确认。

## 配置、快捷方式、缓存与同步如何联动

| 操作 | 影响范围 | 保存方式 | 与其他数据的关系 |
| --- | --- | --- | --- |
| 图片、字体、布局、浮窗、外观与动效 | 当前阅读器界面偏好 | 预览后统一保存 | 可进入设置导出和“设置配置”WebDAV 类别 |
| 快捷方式与阅读交互 | 当前脚本偏好 | 修改后立即保存 | 快捷绑定会随设置配置导出、导入或恢复默认 |
| 导入设置 | 偏好、适用站点、翻译与 WebDAV 非敏感配置 | 确认后事务写入 | 失败时回滚；不会导入秘密凭据、历史、队列或缓存 |
| [恢复全部默认](/settings/data-management#reset-settings) | 设置与本机秘密凭据 | 确认后立即重置 | 不删除阅读队列条目、历史、离线下载或缓存 |
| 清理缓存 | 选中的本机派生数据 | 二次确认后执行 | 不改设置、原站数据或 WebDAV 远端；已同步记录可能再次合并回来 |
| WebDAV 同步 | 用户主动选择的 12 类跨设备记录 | 面板单独保存和执行 | 设置类别不含 WebDAV 用户名、密码或翻译 API Key |

建议先在[数据管理](/settings/data-management)导出配置，再进行大范围导入、恢复默认或缓存排障。需要跨设备时，再单独阅读 [WebDAV 同步](/settings/webdav-sync) 的类别、凭据和删除边界。

## 设置窗口

桌面端可以拖动设置窗口标题区域或搜索栏空白处。输入框、按钮和搜索区域仍保持正常点击，不会误触拖动。窄屏下导航改为横向区域。

## 阅读每个设置页

每个细分页面按相同顺序说明：

1. 从标题栏进入该面板的路径。
2. 每个控件控制什么，以及可选范围。
3. 修改是即时生效、统一保存，还是下次打开阅读器生效。
4. 浮窗、全屏和移动是否独立保存。
5. 常见状态、错误判断和回退方法。

需要快速查默认值时使用[完整设置参考](/settings/reference)；需要理解多项设置如何配合时使用“专题与参考”章节。
