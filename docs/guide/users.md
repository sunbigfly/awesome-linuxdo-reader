---
title: 用户资料与关系
description: 查看用户卡、资料、徽章、统计、关注列表和账号关系操作。
feature_ids: ["MEDIA-007", "USER-001", "USER-002", "USER-003", "USER-004", "USER-005"]
source_anchors: ["openUserAvatarViewer", "renderFallbackUserCard", "fetchUserProfileDetails", "renderUserCardFollowList", "runDirectUserCardAction", "renderSettingsUserInfo"]
since: 0.1.2
version: 0.1.2
status: current
last_verified: 2026-07-23
screenshots: ["/screenshots/guide-02-settings-overview.png"]
---

# 用户资料与关系

## 阅读器用户卡

点击作者头像或用户名打开用户卡。首屏优先使用当前楼层数据和缓存，随后补充：

- 显示名称、用户名、头像和简介；
- 信任级别、用户组与徽章；
- 加入时间、访问和发帖等社区统计；
- 关注、粉丝和相关列表；
- 账号允许的关系操作。

缓存资料可能短暂显示旧值，联网成功后会刷新。用户资料最终以原站为准。

## 头像预览

点击用户卡头像进入媒体预览器，可以缩放、恢复 100%、在序列中前后翻看并下载当前头像。头像资源与结构化用户资料分别缓存。

## 关注和粉丝

人员列表每页 10 人，支持：

- 在关注/粉丝层级之间切换；
- 在当前列表检索；
- 前后翻页；
- 从列表打开另一个用户卡；
- 返回上一级时保留分页状态。

检索会重置到第一页。列表数量和权限由原站 API 决定。

## 用户关系操作

根据当前账号、目标用户和站点能力，用户卡可能显示：

- 关注或取消关注；
- 发起私信；
- 调整该用户的通知级别；
- 静音；
- 按时长忽略；
- 其他站点开放的动作。

这些操作会写入 LINUX DO 账号状态。阅读器会显示进行中和结果信息，但网络中断时仍应回到原站确认。

## 设置中的当前账号

“设置 → 用户信息”集中展示当前登录账号、社区统计以及 Connect 信任级别升级进度，并允许手动刷新。

![设置中心的当前账号信息、社区统计和 Connect 进度](/screenshots/guide-02-settings-overview.png)

该页面可能包含个人数据。提交截图或问题报告前，应遮盖头像、用户名、显示名称、私信内容、唯一统计组合和其他可识别信息。
