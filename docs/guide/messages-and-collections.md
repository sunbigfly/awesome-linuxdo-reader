---
title: 消息、历史与收藏
description: 使用消息分类、检索、分页、历史管理以及收藏与回应中心。
feature_ids: ["ACTION-004", "ACTION-007", "COLLECT-001", "COLLECT-002", "COLLECT-003", "COLLECT-004", "COLLECT-005", "COLLECT-006"]
source_anchors: ["toggleReaderPostReaction", "toggleReaderBookmark", "NOTIFICATION_GROUPS", "ldp-notification-mark-all", "renderHistoryPage", "ldp-history-clear", "BOOKMARK_TAB_LABELS", "ldp-bookmarks-multi"]
since: 0.1.2
version: 0.1.3
status: current
last_verified: 2026-07-23
screenshots: ["/screenshots/guide-15-notifications-replies.png", "/screenshots/guide-16-history.png", "/screenshots/guide-17-bookmarks-reactions.png"]
---

# 消息、历史与收藏

三个标题栏面板分别处理原站通知、本地阅读历史和原站收藏/回应。它们的数据来源和删除语义不同。

## 消息

消息面板分为：

- **全部**；
- **回复**：提及、回复、引用、发帖和组提及；
- **点赞**：点赞、合并点赞和回应；
- **私信**：私信、私信邀请和群组消息摘要。

![消息中心回复分类中的真实通知和目标回跳](/screenshots/guide-15-notifications-replies.png)

每页最多 24 条。检索只筛选已经加载或缓存的消息；没有匹配不等于服务器上不存在。点击消息时，阅读器会打开目标主题、等待楼层挂载并定位。

“全部已读”会调用原站通知能力，影响账号状态；单纯清理消息缓存不会把通知标记为已读。

## 浏览历史

历史是阅读器保存在当前浏览器中的主题访问记录，包括标题、主题 ID、最近楼层、首次查看和最后查看时间。

![浏览历史列表、检索和目标阅读位置](/screenshots/guide-16-history.png)

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
