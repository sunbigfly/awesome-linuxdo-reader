---
title: 动效与其他功能
description: 配置跳转闪烁、等待动画、历史导航、打开位置、回复展示和 Boost 复制。
feature_ids: ["READ-007", "READ-014", "ACTION-006", "SET-010", "SET-011", "SET-016", "SET-017", "SET-018", "SET-019"]
source_anchors: ["historyEdgeTriggerPercent", "JUMP_HIGHLIGHT_SETTING_FIELDS", "BOOST_COPY_SETTING_ROWS", "jumpHighlightPrefsPatch", "READER_LOADING_ANIMATION_KEYS", "ldp-history-buttons-always-visible", "openTopicsAtFirstPost", "expandNestedRepliesByDefault", "boostCopyMode"]
since: 0.1.2
version: 0.1.2
status: current
last_verified: 2026-07-23
screenshots: ["/screenshots/guide-08-motion-settings.png", "/screenshots/guide-12-other-features.png", "/screenshots/guide-18-thread-context.png"]
---

# 动效与其他功能

逐控件说明见[闪烁动效](/settings/motion)和[其他功能](/settings/other)。

![闪烁提示和等待区域动画设置](/screenshots/guide-08-motion-settings.png)

## 目标楼层闪烁

跳转成功后，阅读器以闪烁背景标记目标：

| 参数 | 范围 | 默认 |
| --- | --- | --- |
| 颜色 | 浏览器颜色选择器 | `#0888cc` |
| 圆角 | 0–24 px | 10 px |
| 边框宽度 | 0–4 px | 1 px |
| 速率 | 0.5–2 次/秒 | 0.8 次/秒 |
| 次数 | 1–6 次 | 2 次 |

拖动时即时预览，确认后保存。边框宽度设为 0 可关闭轮廓。

## 等待区域动画

打开主题或切换队列时，可以使用随机模式或十种固定动画：入口、星群、回廊、字浪、晶体、页边批注、章节、引文回声、脚注和互动汇流。

“换一个”只刷新预览。系统开启“减少动态效果”时，阅读器会降低动画幅度和复杂度。

## 历史导航

- **长显左右按钮**：按钮始终显示。
- **左右按钮触发区域**：鼠标进入两侧 0%–15% 区域时显示；0% 表示关闭。
- **浏览历史排序**：最近点击倒序，或首次点击固定顺序。

常显开启后，边缘触发设置不再决定按钮可见性。

## 帖子打开位置

“打开帖子起始楼层号为 #1”只影响普通主题链接。消息、历史、收藏和明确楼层链接仍按其目标定位，避免丢失上下文。

## 回复展示

![父楼层下的二级回复和正式楼层展示](/screenshots/guide-18-thread-context.png)

- 默认展开二级回复：在父楼层下展示直属回复。
- 展开二级回复对应楼层：在主信息流正式位置完整展开。

两项同时打开时可能看到同一回复两次；全部关闭会失去二级回复的默认完整展示，因此阅读器会保留安全提示。

## Boost 复制

复制结果由三部分组成：

`开头文字 + 原 Boost + 小尾巴`

小尾巴可以是数字递增或固定文字。数字模式可设置数字前内容和 1–99 的递增步长；固定尾巴、前缀等文本最多 16 字。结果预览不会发送任何内容。
