---
title: 阅读、快捷方式、帖子与适用站点
description: 配置队列入口、历史、退出、键盘与鼠标快捷方式、主帖操作列、完整讨论、Boost 复制和其他 Discourse 站点。
feature_ids: ["CORE-006", "CORE-007", "READ-007", "READ-015", "ACTION-006", "ACTION-014", "SET-016", "SET-017", "SET-018", "SET-019", "SET-020", "SET-021"]
source_anchors: ["lite/src/queue/reader-open-queue-session.ts","lite/src/app/reader-application.ts","lite/src/history/reader-history-navigation-controller.ts","lite/src/topic/reader-topic-context-controller.ts","lite/src/post/boost-copy-rule.ts","lite/src/post/reader-topic-action-rail.ts","lite/src/state/reader-preferences-schema.ts","lite/src/dom/reply-tree-repository.ts","lite/src/settings/reader-reading-settings-form.ts","lite/src/settings/reader-shortcut-settings-form.ts","lite/src/shell/reader-shortcut-controller.ts"]
since: 0.1.2
version: 1.2.4
status: current
last_verified: 2026-08-07
screenshots: ["/screenshots/guide-12-other-features-v1.0.0.png", "/screenshots/guide-18-thread-context-v1.0.0.png", "/screenshots/guide-26-reading-navigation-v1.0.0.png", "/screenshots/guide-27-shortcuts-v1.0.0.png", "/screenshots/guide-28-applicable-sites-v1.0.0.png"]
---

# 阅读、快捷方式、帖子与适用站点

设置中心将阅读与站点相关选项拆分为四个面板：

- **阅读与导航**：队列入口、历史、帖子打开位置和退出方式；
- **快捷方式**：为导航、阅读工具、面板、帖子操作、窗口和队列绑定键盘或鼠标操作；
- **帖子与回复**：主帖操作列、二级回复显示位置和 Boost 复制；
- **适用站点**：其他 HTTPS Discourse 论坛。

![阅读与导航面板中的队列入口、历史、打开位置和退出设置](/screenshots/guide-26-reading-navigation-v1.0.0.png)

## 阅读队列入口

“队列为空时仍显示入口”默认开启。空队列按钮显示关闭符号而不是文章数：

- 点击入口仍可确认当前队列为空；
- 点击右上角关闭操作会同时关闭面板并保存“空队列时隐藏”；
- 加入第一篇文章后，入口不受该设置影响并恢复显示数量。

## 历史导航与退出

| 设置 | 可选值 | 结果 |
| --- | --- | --- |
| 始终显示前进和后退按钮 | 开 / 关 | 有可用历史时一直显示；关闭后由边缘唤出 |
| 边缘唤出按钮范围 | 0%–15% | 指针进入两侧区域时显示按钮；0% 关闭边缘唤出 |
| 历史列表排序 | 最近打开 / 首次打开 | 决定历史列表与前后切换顺序 |
| 普通帖子从第 1 楼打开 | 开 / 关 | 只影响普通帖子链接 |
| 按两次 Esc 关闭阅读器 | 开 / 关 | 开启后须在 1.5 秒内连续按两次；关闭后按一次即可 |
| 关闭原生回复窗口前再次确认 | 开 / 关 | 开启后，按 Esc、关闭或舍弃草稿须在 1.5 秒内重复同一操作 |

新配置默认关闭阅读器本体的“两次 Esc”，但默认开启原生回复窗口的关闭确认。前者决定临时层都关闭后如何退出阅读器，后者只保护未关闭的原生回复窗口；已有明确保存值继续沿用。

完整讨论、父回复预览、大图查看器、代码预览和原生回复编辑器会先消费 `Esc`。只有这些临时层都已关闭时，双击退出规则才作用于阅读器本体。

## 帖子打开位置

“打开帖子起始楼层号为 #1”只影响普通主题链接：

- 开启：从主题首帖开始；
- 关闭：优先恢复最近阅读位置；
- 消息、收藏、历史和明确楼层链接：始终按目标楼层定位。

因此，这个开关不会破坏带楼层目标的回跳。

## 快捷方式

![快捷方式面板中的键盘、滚轮和鼠标侧键绑定](/screenshots/guide-27-shortcuts-v1.0.0.png)

快捷方式分为浏览导航、阅读工具、界面面板、帖子操作、窗口与队列五组。点击某个动作右侧的“添加”后，按下键盘组合键、滚轮、鼠标中键、后退键或前进键即可保存；“清空”“默认”和“全部恢复默认”分别管理单项或全部绑定。

- 每个动作最多保留 3 个快捷方式；
- 同一组合不能同时属于两个动作；
- 浏览器常用保留键不会保存；
- 单个字母或数字必须至少搭配 `Ctrl`、`Alt`、`Shift` 或 `Meta`，避免与论坛快捷键冲突；
- 在输入框、编辑器或需要键盘操作的控件中，阅读器不会抢占普通输入。

快捷方式修改会立即写入当前脚本配置，不进入底部的统一草稿队列。动作暂时不可用时只显示提示，不会改走另一项社区操作。

## 主帖操作列

![帖子与回复面板中的主帖操作列和二级回复设置](/screenshots/guide-12-other-features-v1.0.0.png)

“始终显示主帖操作列”默认开启；“锁定操作列位置”默认关闭。未锁定时长按操作列收纳按钮约 420 ms 后拖动，位置会保存；“恢复默认”将其放回正文左侧。

操作列包含回顶、点赞、回复、Boost 和收藏，展开后补充分享、通知等主题操作。站点缺少某项插件或账号没有权限时，对应入口不会出现。

## 二级回复显示位置

![父楼层下展开的二级回复、关系线和正式楼层](/screenshots/guide-18-thread-context-v1.0.0.png)

| 设置 | 结果 |
| --- | --- |
| 在父回复下展开二级回复 | 直接显示父回复收到的回复 |
| 启用深层回复阅读 | 允许使用完整讨论或主信息流树状嵌套 |
| 深层回复展示方式 | 直接进入完整讨论，或先显示 2–5 层主信息流树状嵌套 |
| 从楼层列表隐藏二级回复 | 将正式楼层收纳为参与者头像标记，跳转仍可定位 |

深层回复阅读建立在父回复下展开之上；关闭它仍可保留普通直属回复分页。主信息流超出所选深度后进入完整讨论；完整讨论按真实父子关系无限递归，窄窗口只停止继续缩进。默认继续使用完整讨论窗口，不改变已有用户的阅读方式。

## Boost 复制

复制结果由三部分组成：

`前置文字 + 原 Boost + 末尾内容`

1. 选择数字递增或固定文字。
2. 数字模式设置 1–99 的步长，并填写数字前文字。
3. 固定模式填写最多 16 字的末尾文字。
4. 在预览中检查最终结果。
5. 实际点击复制时，才把结果预填到该楼层的 Boost 输入框。

这个设置只改变预填文本，不会自动发送或覆盖原 Boost。

## 其他适用站点

![适用站点面板中的 HTTPS Discourse 论坛验证入口](/screenshots/guide-28-applicable-sites-v1.0.0.png)

输入 HTTPS Discourse 论坛的域名或完整网址，点击“验证并添加”。阅读器会匿名访问该站点的 `/site/basic-info.json`；检测到 Discourse 公开站点信息后才会保存。已内置站点不需要重复添加，保存的域名可以在同一区域移除。

自定义域名保存在脚本管理器的全局脚本存储中。添加后访问该站并完整刷新页面即可使用；若目标不是 Discourse、拒绝访问公开接口或请求超时，阅读器不会保存。
