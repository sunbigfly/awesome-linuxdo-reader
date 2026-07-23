---
title: 其他功能
description: 配置历史按钮、边缘触发、历史排序、帖子起始楼层、二级回复展示和 Boost 复制。
feature_ids: ["READ-007", "ACTION-006", "SET-016", "SET-017", "SET-018", "SET-019"]
source_anchors: ["historyEdgeTriggerPercent", "BOOST_COPY_SETTING_ROWS", "ldp-history-buttons-always-visible", "openTopicsAtFirstPost", "expandNestedRepliesByDefault", "boostCopyMode"]
since: 0.1.2
version: 0.1.3
status: current
last_verified: 2026-07-23
screenshots: ["/screenshots/guide-12-other-features.png", "/screenshots/guide-18-thread-context.png"]
---

# 其他功能

路径：**阅读器标题栏 → 设置 → 其他功能**。

![其他功能页中的历史导航、打开位置、回复展示和 Boost 复制](/screenshots/guide-12-other-features.png)

## 历史导航

| 设置 | 可选值 | 结果 |
| --- | --- | --- |
| 长显左右按钮 | 开 / 关 | 开启后，上一条/下一条历史按钮始终显示 |
| 左右按钮触发区域 | 0%–15% | 鼠标进入两侧区域时显示按钮；0% 关闭边缘触发 |
| 浏览历史排序 | 最近点击 / 首次点击 | 决定历史列表与前后切换顺序 |

常显开启后，边缘触发范围不再决定按钮可见性。历史为空或已到边界时，对应按钮禁用。

## 帖子打开位置

“打开帖子起始楼层号为 #1”只影响普通主题链接：

- 开启：从主题首帖开始；
- 关闭：优先恢复最近阅读位置；
- 消息、收藏、历史和明确楼层链接：始终按目标楼层定位。

因此，这个开关不会破坏带楼层目标的回跳。

## 二级回复展示

![父楼层下展开的二级回复、关系线和正式楼层](/screenshots/guide-18-thread-context.png)

| 设置 | 位置 |
| --- | --- |
| 默认展开二级回复 | 父楼层下的上下文区域 |
| 展开二级回复对应楼层 | 主信息流中的正式楼层位置 |

两项都开时，同一回复可能出现两次：一次表达父子关系，一次保留正式楼层位置。至少保留一种完整展开方式；设置中心会对可能丢失上下文的组合给出提示。

## Boost 复制

复制结果由三部分组成：

`开头文字 + 原 Boost + 小尾巴`

1. 选择数字递增或固定文字。
2. 数字模式设置 1–99 的步长，并填写数字前文字。
3. 固定模式填写最多 16 字的小尾巴。
4. 在预览中检查最终结果。
5. 实际点击复制时才写入剪贴板。

这个设置只改变复制文本，不会编辑、发送或覆盖原 Boost。
