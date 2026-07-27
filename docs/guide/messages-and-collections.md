---
title: 消息、历史与收藏
description: 使用消息分类、检索、分页、历史管理以及收藏与回应中心。
feature_ids: ["ACTION-004", "ACTION-007", "COLLECT-001", "COLLECT-002", "COLLECT-003", "COLLECT-004", "COLLECT-005", "COLLECT-006"]
source_anchors: ["toggleReaderPostReaction", "toggleReaderBookmark", "NOTIFICATION_GROUPS", "notificationTypeIconName", "notificationHref", "ldp-notification-mark-all", "renderHistoryPage", "ldp-history-clear", "BOOKMARK_TAB_LABELS", "ldp-bookmarks-multi"]
since: 0.1.2
version: 0.1.14
status: current
last_verified: 2026-07-25
screenshots: ["/screenshots/guide-15-notifications-replies.png", "/screenshots/guide-16-history.png", "/screenshots/guide-17-bookmarks-reactions.png"]
---

# 消息、历史与收藏

三个标题栏面板分别处理原站通知、本地阅读历史和原站收藏/回应。它们的数据来源和删除语义不同。

## 消息

消息面板分为七类：

| 分类 | 包含的常见通知 |
| --- | --- |
| 全部 | 当前账号可见的所有通知 |
| 回复 | 提及、回复、引用、发帖和组提及 |
| 点赞 | 点赞、合并点赞和回应 |
| Boost | Boost 通知 |
| 关注 | 关注关系、关注对象发帖或回复、首帖关注以及分类/标签关注 |
| 私信 | 私信、私信邀请、群组摘要，以及聊天提及、消息、邀请、引用和关注会话 |
| 其他 | 编辑、移动、链接、徽章、提醒、审核、指定和其他系统通知 |

![消息中心回复分类中的真实通知和目标回跳](/screenshots/guide-15-notifications-replies.png)

<p class="image-caption">从标题栏打开消息中心，先选择消息类别，再点击具体通知；阅读器会进入对应主题并定位到目标楼层。</p>

分类标签和每条消息都使用可访问的 Lucide 图标。每种通知类型优先使用自己的语义图标，例如提及使用 `@`、回复使用回箭头、点赞使用爱心、Boost 使用火箭；无法识别时才回退到所属分类图标。消息卡片把类型图标放在独立圆形栏位，并为回复、点赞、Boost、关注、私信和其他分类使用不同强调色，同时保留摘要、相对时间和明确的“已读/未读”状态。

每页最多 24 条。检索只筛选已经加载或缓存的消息；没有匹配不等于服务器上不存在。点击消息时，阅读器会打开目标主题、等待楼层挂载并定位。同一主题内的新目标楼层会在现有阅读器中直接跳转；Boost 通知会强制刷新目标附近数据，避免继续显示旧缓存。

通知优先从 Discourse 展示模型、展示链接、`post_url/topic_url/url`、通知本体及其 `data` 中归一化 `topic_id`、`post_number`，并把目标编号写入卡片。只有确实没有主题 ID 时才回退到原站通知页。

若目标主题已经在当前阅读器中打开，点击通知会先关闭消息面板并直接调用现有时间轴跳到目标楼层；跳转失败时才重新打开目标主题。这样同主题通知不会无意义地重建整个阅读器。

“全部已读”会调用原站通知能力，影响账号状态。在具体分类中执行时只处理该分类支持的通知类型；单纯清理消息缓存不会把通知标记为已读。

## 浏览历史

历史是阅读器保存在当前浏览器中的主题访问记录，包括标题、主题 ID、最近楼层、首次查看和最后查看时间。

![浏览历史列表、检索和目标阅读位置](/screenshots/guide-16-history.png)

<p class="image-caption">打开历史面板后可检索、排序和多选；点击一条历史记录会恢复该主题最近保存的阅读位置。</p>

可用操作：

- 检索标题、分类等已保存字段；
- 每页 20 条；
- 按最近点击或首次点击排序；
- 多选本页/全部页记录并删除；
- 清空全部历史；
- 点击条目恢复目标楼层。

删除历史不可撤销，但不会删除浏览器访问历史或 LINUX DO 账号记录。

## 收藏与回应

![回应、主题书签和楼层书签统一入口](/screenshots/guide-17-bookmarks-reactions.png)

<p class="image-caption">在收藏与回应中心切换“回应、帖子、楼层”标签；先确认对象类型，再执行跳转或移除。</p>

三个标签：

| 标签 | 数据来源 | 主要操作 |
| --- | --- | --- |
| 回应 | 当前账号给出的回应与点赞 | 按表情筛选、跳到楼层、取消回应 |
| 帖子 | 主题书签 | 检索、跳到主题、移除 |
| 楼层 | 楼层书签 | 检索、跳到精确楼层、移除 |

标签可以拖动排序，首项成为默认入口。列表每页 20 条；点赞来源可能按更大批次获取，再归一化到面板分页。

## 多选安全边界

进入多选后可以选择“本页”或“全部页”。执行删除前确认对象类型：

- 历史删除只改本地数据；
- 收藏/回应移除会改变原站账号状态；
- 缓存清理不等于上述任何业务删除。
