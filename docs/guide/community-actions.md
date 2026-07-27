---
title: 回复与社区操作
description: 使用主帖操作列，并在阅读器内回复、引用、点赞、回应、Boost、收藏、分享和执行权限操作。
feature_ids: ["MEDIA-010", "ACTION-001", "ACTION-002", "ACTION-003", "ACTION-004", "ACTION-005", "ACTION-006", "ACTION-007", "ACTION-008", "ACTION-009", "ACTION-010", "ACTION-011", "ACTION-012", "ACTION-013", "ACTION-014"]
source_anchors: ["renderReaderPoll", "syncTopicActionRail", "ldp-replybtn", "data-selection-action=\"quote\"", "toggleReaderPostLike", "toggleReaderPostReaction", "renderBoostBubble", "quoteBoostInNativeReply", "BOOST_COPY_SETTING_ROWS", "toggleReaderBookmark", "name: 'share'", "TOPIC_NOTIFICATION_LEVELS", "openReaderReportDialog", "name: 'edit'", "composer:edited-post", "openReaderAssignDialog", "topicSharedIssueState"]
since: 0.1.2
version: 0.1.14
status: current
last_verified: 2026-07-27
screenshots: ["/screenshots/guide-20-community-actions.png", "/screenshots/guide-17-bookmarks-reactions.png", "/screenshots/guide-15-notifications-replies.png"]
---

# 回复与社区操作

阅读器调用 LINUX DO 的原生账号和接口能力。按钮是否出现、操作是否允许、最终计数和权限错误都以原站为准。

![楼中楼中的回应、点赞、回复、Boost 和主题底部操作](/screenshots/guide-20-community-actions.png)

<p class="image-caption">先在楼层底部找到回复、点赞、回应和 Boost；主题级分享、收藏、通知和回复入口位于正文末尾。</p>

## 主帖操作列

0.1.14 默认在正文左侧显示主帖快捷操作列，集中提供：

- 回到主题顶部；
- 主帖点赞及计数；
- 回复主题；
- Boost（站点支持且账号可用时）；
- 收藏主题；
- 展开后的分享、通知和其他主题操作。

点赞、收藏和 Boost 状态会与主帖正文及实时更新同步。操作列展开时会暂时避让历史按钮；接近左右边缘时只保留收纳按钮，悬停或聚焦后恢复。

“设置 → 帖子与回复 → 主帖操作列”可以：

1. 关闭“始终显示主帖操作列”；
2. 锁定当前位置；
3. 在未锁定时长按收纳按钮约 420 ms 后拖动；
4. 恢复到正文左侧默认位置。

拖动位置按阅读器尺寸保存，窗口缩放或形态变化时会重新限制在可用范围内。

全屏时，标题栏会跟随正文左右边界对齐，阅读队列入口也会跟随操作列收纳按钮的横向中心；拖动操作列或修改全屏布局后会自动重新计算，避免三个入口互相遮挡。

## 回复与引用

点击楼层底部“回复”会以该楼层为目标打开编辑器；主题末尾“回复主题”创建普通主题回复。

选中正文后会出现：

- **引用**：把选中内容和来源信息插入回复编辑器；
- **复制引用**：生成可粘贴的引用文本，不打开编辑器。

发送前仍应检查目标用户、引用范围和草稿内容。切换工作区形态时，编辑器窗口按浮窗、全屏、移动分别保存几何设置。

编辑已有楼层时，阅读器使用与回复相同的宿主隔离提交链路。保存成功后会重新读取该楼层并就地刷新；如果编辑的是楼中楼回复，阅读器会重新聚焦对应的直属讨论，不会让宿主页面自行跳走。

## 点赞与回应

- 点赞按钮切换当前账号的点赞状态，并同步计数。
- 回应区域显示已注册的自定义表情、数量和自己的当前选择。
- 再次点击自己的回应可取消；选择另一项时切换到新回应。
- 回应中心的数据会与实时主题通道和权威楼层数据校准。

![收藏与回应中心展示真实原站记录](/screenshots/guide-17-bookmarks-reactions.png)

<p class="image-caption">点击标题栏的收藏与回应入口，可以核对当前账号已经点过的回应、主题书签和楼层书签。</p>

## Boost

Boost 气泡显示内容和参与用户。账号权限允许时可以发送、举报或进入相关原生操作。

登录后，带用户名的 Boost 会显示 `@` 操作：

1. 点击 `@` 后，阅读器打开该楼层的原生回复编辑器；
2. 编辑器自动插入包含 Boost 正文的引用块，并在末尾加入原作者的 `@用户名`；
3. 如果当前草稿已经提及该用户，阅读器只聚焦编辑器，不会重复插入；
4. 自动填充只修改当前草稿，不会立即发送，也不会修改原 Boost。发送前请检查引用内容和目标用户。

“设置 → 帖子与回复 → 复制 Boost 文本”只改变复制到剪贴板的文本：

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

![消息中心按不同通知类型分类展示消息](/screenshots/guide-15-notifications-replies.png)

<p class="image-caption">通知设置生效后，从标题栏打开消息中心；使用顶部分类筛选通知，再点击消息返回目标楼层。</p>

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
