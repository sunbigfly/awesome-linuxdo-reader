---
title: 回复与社区操作
description: 在阅读器内回复、引用、点赞、回应、Boost、收藏、分享和执行权限操作。
feature_ids: ["MEDIA-010", "ACTION-001", "ACTION-002", "ACTION-003", "ACTION-004", "ACTION-005", "ACTION-006", "ACTION-007", "ACTION-008", "ACTION-009", "ACTION-010", "ACTION-011", "ACTION-012", "ACTION-013"]
source_anchors: ["renderReaderPoll", "ldp-replybtn", "data-selection-action=\"quote\"", "toggleReaderPostLike", "toggleReaderPostReaction", "renderBoostBubble", "BOOST_COPY_SETTING_ROWS", "toggleReaderBookmark", "name: 'share'", "TOPIC_NOTIFICATION_LEVELS", "openReaderReportDialog", "name: 'edit'", "openReaderAssignDialog", "topicSharedIssueState"]
since: 0.1.2
version: 0.1.4
status: current
last_verified: 2026-07-24
screenshots: ["/screenshots/guide-20-community-actions.png", "/screenshots/guide-17-bookmarks-reactions.png", "/screenshots/guide-15-notifications-replies.png"]
---

# 回复与社区操作

阅读器调用 LINUX DO 的原生账号和接口能力。按钮是否出现、操作是否允许、最终计数和权限错误都以原站为准。

![楼中楼中的回应、点赞、回复、Boost 和主题底部操作](/screenshots/guide-20-community-actions.png)

<p class="image-caption">先在楼层底部找到回复、点赞、回应和 Boost；主题级分享、收藏、通知和回复入口位于正文末尾。</p>

## 回复与引用

点击楼层底部“回复”会以该楼层为目标打开编辑器；主题末尾“回复主题”创建普通主题回复。

选中正文后会出现：

- **引用**：把选中内容和来源信息插入回复编辑器；
- **复制引用**：生成可粘贴的引用文本，不打开编辑器。

发送前仍应检查目标用户、引用范围和草稿内容。切换工作区形态时，编辑器窗口按浮窗、全屏、移动分别保存几何设置。

## 点赞与回应

- 点赞按钮切换当前账号的点赞状态，并同步计数。
- 回应区域显示已注册的自定义表情、数量和自己的当前选择。
- 再次点击自己的回应可取消；选择另一项时切换到新回应。
- 回应中心的数据会与实时主题通道和权威楼层数据校准。

![收藏与回应中心展示真实原站记录](/screenshots/guide-17-bookmarks-reactions.png)

<p class="image-caption">点击标题栏的收藏与回应入口，可以核对当前账号已经点过的回应、主题书签和楼层书签。</p>

## Boost

Boost 气泡显示内容和参与用户。账号权限允许时可以发送、举报或进入相关原生操作。

“设置 → 其他功能 → Boost 复制”只改变复制到剪贴板的文本：

- 开头文字；
- 数字递增模式及步长；
- 固定尾巴模式；
- 最终结果预览，尾巴最多 16 字。

它不会修改原 Boost 内容。

## 收藏与分享

| 对象 | 能力 |
| --- | --- |
| 主题 | 添加/移除主题书签、调用分享 |
| 普通楼层 | 添加/移除楼层书签、复制精确链接 |
| 收藏与回应中心 | 按回应、主题、楼层查看并批量移除 |

删除本地缓存不会撤销原站收藏；从收藏中心执行移除才会改变原站状态。

## 主题通知

主题底部的通知级别选择器沿用 Discourse 状态，例如正常、跟踪、关注和静音。修改后影响原站为当前账号发送通知的方式，不只是阅读器本地显示。

![消息中心按回复、点赞和私信分类展示通知](/screenshots/guide-15-notifications-replies.png)

<p class="image-caption">通知设置生效后，从标题栏打开消息中心；使用顶部分类筛选回复、提及、点赞或私信，再点击消息返回目标楼层。</p>

## 投票

投票区域按题型允许单选或多选，可提交、更新、撤销并切换结果。关闭、过期、已锁定或无权限投票时，阅读器按原站状态禁用操作。

## 高权限和敏感操作

以下按钮按主题、楼层和账号权限动态出现：

- 编辑或删除楼层；
- 举报主题、楼层或 Boost；
- 指定主题/楼层负责人；
- 管理楼层；
- 支持插件提供的“俺也一样”。

删除、举报、指定和管理操作会先显示确认或表单。它们属于真实外部写入，不是本地预览；提交前应核对目标和理由。
